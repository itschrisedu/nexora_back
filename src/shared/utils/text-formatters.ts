/**
 * Utilidades de formato y normalización estricta de texto para el Backend NEXORA.
 * Implementa las reglas de validación para nombres, apellidos, emails, teléfonos y direcciones.
 */

export function capitalizarPalabra(palabra: string): string {
  if (!palabra) return '';
  const limpia = palabra.trim();
  if (!limpia) return '';
  return limpia.charAt(0).toUpperCase() + limpia.slice(1).toLowerCase();
}

export function formatearNombres(valor: string, maxPalabras: number = 3): string {
  if (!valor) return '';
  const soloLetras = valor.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '');
  const palabras = soloLetras.split(/\s+/).filter(Boolean);
  const palabrasPermitidas = palabras.slice(0, maxPalabras);
  const formateadas = palabrasPermitidas.map(capitalizarPalabra);
  return formateadas.join(' ');
}

export function formatearApellidos(valor: string): string {
  return formatearNombres(valor, 2);
}

export function dividirNombres(nombresStr: string): {
  primerNombre: string;
  segundoNombre: string;
  tercerNombre: string;
  lista: string[];
} {
  const palabras = (nombresStr || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizarPalabra);
  return {
    primerNombre: palabras[0] || '',
    segundoNombre: palabras[1] || '',
    tercerNombre: palabras[2] || '',
    lista: palabras.slice(0, 3),
  };
}

export function dividirApellidos(apellidosStr: string): {
  primerApellido: string;
  segundoApellido: string;
  lista: string[];
} {
  const palabras = (apellidosStr || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizarPalabra);
  return {
    primerApellido: palabras[0] || '',
    segundoApellido: palabras[1] || '',
    lista: palabras.slice(0, 2),
  };
}

export function formatearEmail(email: string): string {
  if (!email) return '';
  return email.toLowerCase().replace(/\s+/g, '').trim();
}

export function validarEmailEstricto(email: string): { valido: boolean; mensaje?: string } {
  const limpio = formatearEmail(email);
  if (!limpio) {
    return { valido: true };
  }
  
  const arrobas = (limpio.match(/@/g) || []).length;
  if (arrobas === 0) {
    return { valido: false, mensaje: 'El correo electrónico debe incluir el símbolo "@".' };
  }
  if (arrobas > 1) {
    return { valido: false, mensaje: 'El correo electrónico solo puede contener un único símbolo "@".' };
  }

  const partes = limpio.split('@');
  const usuario = partes[0];
  const dominio = partes[1];

  if (!usuario || !dominio) {
    return { valido: false, mensaje: 'El formato del correo es incompleto (ej: usuario@empresa.com).' };
  }

  if (!dominio.includes('.') || dominio.startsWith('.') || dominio.endsWith('.')) {
    return { valido: false, mensaje: 'El dominio del correo electrónico debe incluir una extensión válida (ej: .com, .ec).' };
  }

  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  if (!emailRegex.test(limpio)) {
    return { valido: false, mensaje: 'El correo electrónico contiene caracteres no válidos.' };
  }

  return { valido: true };
}

export function formatearTelefono(telefono: string): string {
  if (!telefono) return '';
  let limpio = telefono.replace(/\D/g, '');
  if (limpio.startsWith('5939') && limpio.length === 12) {
    limpio = '0' + limpio.substring(3);
  }
  return limpio.slice(0, 10);
}

export function validarTelefonoEstricto(telefono: string): { valido: boolean; mensaje?: string } {
  const limpio = formatearTelefono(telefono);
  if (!limpio) {
    return { valido: true };
  }
  if (limpio.length !== 10) {
    return { valido: false, mensaje: 'El teléfono celular debe tener exactamente 10 dígitos numéricos.' };
  }
  if (!limpio.startsWith('09')) {
    return { valido: false, mensaje: 'El teléfono celular debe comenzar con 09 (ej: 0991234567).' };
  }
  return { valido: true };
}

export function formatearDireccion(direccion: string): string {
  if (!direccion) return '';
  const limpia = direccion.trim();
  if (!limpia) return '';
  return limpia.charAt(0).toUpperCase() + limpia.slice(1);
}

export function normalizarNombreNegocioBD(nombre: string): string {
  if (!nombre) return '';
  return nombre.toLowerCase().trim();
}
