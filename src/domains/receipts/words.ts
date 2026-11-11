const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize']
const TENS: Record<number, string> = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' }

function underTwenty(n: number): string {
  return n < 17 ? UNITS[n] : `dix-${UNITS[n - 10]}`
}

function underHundred(n: number): string {
  if (n < 20) return underTwenty(n)
  const tens = Math.floor(n / 10)
  const unit = n % 10
  if (tens in TENS) return unit === 0 ? TENS[tens] : `${TENS[tens]}${unit === 1 ? ' et un' : `-${UNITS[unit]}`}`
  if (tens === 7) return n === 71 ? 'soixante et onze' : `soixante-${underTwenty(n - 60)}`
  return n === 80 ? 'quatre-vingts' : `quatre-vingt-${underTwenty(n - 80)}`
}

/** Nombre entier (0 à 999 999) en lettres, orthographe française (« deux cents », « quatre-vingts »). */
export function numberInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new RangeError(`Nombre hors limites : ${n}`)
  if (n >= 1000) {
    const thousands = Math.floor(n / 1000)
    const rest = n % 1000
    // « vingts » et « cents » restent invariables devant « mille ».
    const head = thousands === 1 ? 'mille' : `${numberInWords(thousands).replace(/(vingt|cent)s$/, '$1')} mille`
    return rest === 0 ? head : `${head} ${numberInWords(rest)}`
  }
  if (n >= 100) {
    const hundreds = Math.floor(n / 100)
    const rest = n % 100
    const head = hundreds === 1 ? 'cent' : `${UNITS[hundreds]} cent${rest === 0 ? 's' : ''}`
    return rest === 0 ? head : `${head} ${underHundred(rest)}`
  }
  return underHundred(n)
}

/** Montant en centimes en lettres : « huit cent cinquante euros et vingt centimes ». */
export function centsInWords(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new RangeError(`Montant invalide : ${cents}`)
  const euros = Math.floor(cents / 100)
  const rest = cents % 100
  const main = `${numberInWords(euros)} ${euros < 2 ? 'euro' : 'euros'}`
  return rest === 0 ? main : `${main} et ${numberInWords(rest)} centime${rest > 1 ? 's' : ''}`
}
