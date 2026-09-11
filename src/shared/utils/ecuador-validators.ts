/**
 * Validador de Cédula Ecuatoriana (Algoritmo Módulo 10).
 * - Exactamente 10 dígitos numéricos.
 * - Código de provincia (dos primeros dígitos) entre 01 y 24, o 30.
 * - Tercer dígito menor a 6 para personas naturales.
 */
export function validarCedula(cedula: string): boolean {
  if (!cedula) return false;
  const limpia = cedula.trim().replace(/\D/g, '');
  if (limpia.length !== 10) return false;

  const provincia = parseInt(limpia.substring(0, 2), 10);
  if ((provincia < 1 || provincia > 24) && provincia !== 30) {
    return false;
  }

  const tercerDigito = parseInt(limpia.charAt(2), 10);
  if (tercerDigito < 0 || tercerDigito > 5) {
    return false;
  }

  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;

  for (let i = 0; i < 9; i++) {
    let valor = parseInt(limpia.charAt(i), 10) * coeficientes[i];
    if (valor >= 10) valor -= 9;
    suma += valor;
  }

  const digitoVerificador = parseInt(limpia.charAt(9), 10);
  const residuo = suma % 10;
  const resultadoEsperado = residuo === 0 ? 0 : 10 - residuo;

  return resultadoEsperado === digitoVerificador;
}

/**
 * Validador de RUC Ecuatoriano (Persona Natural, Sociedad Privada o Pública).
 * - Exactamente 13 dígitos numéricos.
 * - Persona Natural: Cédula válida (10 dígitos) + establecimiento (001 a 999).
 * - Sociedad Privada (3er dígito 9): Módulo 11 con coeficientes [4,3,2,7,6,5,4,3,2].
 * - Sociedad Pública (3er dígito 6): Módulo 11 con coeficientes [3,2,7,6,5,4,3,2].
 */
export function validarRuc(ruc: string): boolean {
  if (!ruc) return false;
  const limpio = ruc.trim().replace(/\D/g, '');
  if (limpio.length !== 13) return false;

  const provincia = parseInt(limpio.substring(0, 2), 10);
  if ((provincia < 1 || provincia > 24) && provincia !== 30) {
    return false;
  }

  const tercerDigito = parseInt(limpio.charAt(2), 10);

  // 1. RUC Persona Natural (3er dígito 0-5) -> 10 primeros dígitos es cédula válida + establecimiento (001)
  if (tercerDigito >= 0 && tercerDigito <= 5) {
    const establecimiento = parseInt(limpio.substring(10, 13), 10);
    if (establecimiento < 1) return false;
    return validarCedula(limpio.substring(0, 10));
  }

  // 2. RUC Sociedad Privada / Extranjeros sin cédula (3er dígito 9)
  if (tercerDigito === 9) {
    const establecimiento = parseInt(limpio.substring(10, 13), 10);
    if (establecimiento < 1) return false;

    const coeficientes = [4, 3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    for (let i = 0; i < 9; i++) {
      suma += parseInt(limpio.charAt(i), 10) * coeficientes[i];
    }
    const residuo = suma % 11;
    const verificador = residuo === 0 ? 0 : 11 - residuo;
    return verificador === parseInt(limpio.charAt(9), 10);
  }

  // 3. RUC Entidad Pública (3er dígito 6)
  if (tercerDigito === 6) {
    const establecimiento = parseInt(limpio.substring(9, 13), 10);
    if (establecimiento < 1) return false;

    const coeficientes = [3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    for (let i = 0; i < 8; i++) {
      suma += parseInt(limpio.charAt(i), 10) * coeficientes[i];
    }
    const residuo = suma % 11;
    const verificador = residuo === 0 ? 0 : 11 - residuo;
    return verificador === parseInt(limpio.charAt(8), 10);
  }

  return false;
}

/**
 * Validador de Teléfono Celular Ecuatoriano.
 * - Exactamente 10 dígitos numéricos.
 * - Debe comenzar por 09 (ej. 0991234567).
 * - Acepta también entrada en formato internacional +593 / 593 normalizándolo a 09.
 */
export function validarTelefonoCelular(telefono: string): boolean {
  if (!telefono) return false;
  let limpio = telefono.trim().replace(/\D/g, '');

  if (limpio.startsWith('5939') && limpio.length === 12) {
    limpio = '0' + limpio.substring(3);
  }

  return /^\d{10}$/.test(limpio) && limpio.startsWith('09');
}

/**
 * Normaliza el número de teléfono celular para almacenamiento limpio.
 */
export function normalizarTelefonoCelular(telefono: string): string {
  if (!telefono) return '';
  let limpio = telefono.trim().replace(/\D/g, '');
  if (limpio.startsWith('5939') && limpio.length === 12) {
    limpio = '0' + limpio.substring(3);
  }
  return limpio;
}
