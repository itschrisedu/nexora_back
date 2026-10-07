import dns from 'node:dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (_) {}

// Resolver DNS público de alta disponibilidad (Google DNS y Cloudflare DNS)
// Resuelve el problema donde routers locales o ISPs bloquean o rechazan (RCODE_REFUSED)
// la resolución de dominios en la nube como Neon PostgreSQL (*.neon.tech) o AWS, o IPv6 inalcanzable.
const originalLookup = dns.lookup.bind(dns);
const publicResolver = new dns.Resolver();
publicResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

(dns as any).lookup = (hostname: string, options: any, callback: any) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  // Si es un dominio de Neon, AWS, o SMTP de correo, resolver siempre a IPv4
  if (
    hostname.includes('neon.tech') ||
    hostname.includes('aws') ||
    hostname.includes('gmail') ||
    hostname.includes('google') ||
    hostname.includes('smtp') ||
    hostname.includes('outlook') ||
    hostname.includes('yahoo')
  ) {
    return publicResolver.resolve4(hostname, (err: any, addresses: string[]) => {
      if (err || !addresses || addresses.length === 0) {
        return originalLookup(hostname, { ...(options || {}), family: 4 }, callback);
      }
      if (options && options.all) {
        return callback(null, addresses.map((addr: string) => ({ address: addr, family: 4 })));
      }
      return callback(null, addresses[0], 4);
    });
  }

  // Para otros dominios, intentar lookup del sistema y si falla por DNS rechazado, usar fallback
  return originalLookup(hostname, options, (err: any, address: any, family: any) => {
    if (err && (err.code === 'ENOTFOUND' || err.code === 'EREFUSED' || err.code === 'ETIMEOUT')) {
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
