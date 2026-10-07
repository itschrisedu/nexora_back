import dns from 'node:dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_) {}

const originalLookup = dns.lookup.bind(dns);
const publicResolver = new dns.Resolver();
publicResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

(dns as any).lookup = (hostname: string, options: any, callback: any) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  // Asegurar preferencia de IPv4 para evitar ENETUNREACH en redes sin IPv6
  const lookupOptions =
    typeof options === 'object' && options !== null
      ? { family: 4, ...options }
      : { family: 4 };

  // 1. Intentar SIEMPRE primero la resolución nativa del sistema (ultra rápida ~20ms)
  return originalLookup(hostname, lookupOptions, (err: any, address: any, family: any) => {
    // Si la resolución nativa funcionó, responder inmediatamente sin demoras
    if (!err && address) {
      return callback(null, address, family || 4);
    }

    // 2. Solo si el DNS local falló (ej. ISP bloquea dominios de Neon *.neon.tech), usar fallback público
    if (err && (err.code === 'ENOTFOUND' || err.code === 'EREFUSED' || err.code === 'ETIMEOUT' || err.code === 'ESERVFAIL')) {
      return publicResolver.resolve4(hostname, (pErr: any, addresses: string[]) => {
        if (pErr || !addresses || addresses.length === 0) {
          return callback(err, address, family);
        }
        if (options && options.all) {
          return callback(null, addresses.map((addr: string) => ({ address: addr, family: 4 })));
        }
        return callback(null, addresses[0], 4);
      });
    }

    return callback(err, address, family);
  });
};

