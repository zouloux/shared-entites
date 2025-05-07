/**
 * Generates a simple unique identifier (UID) based on the current time and random entropy.
 * @param baseTime - The base timestamp value used to calculate the UID relative time.
 * 									Can be Date.now() gathered at server start.
 * 									This value should not move while server is running.
 * @param timeEntropy - Time entropy, 1 is millisecond, 1 / 1000 is seconds;
 * @param randomEntropy - Max random entropy, default is 8, max is 16, 0 to ignore this part.
 * @param radix - The base or radix for converting numeric values to strings. Defaults to 36.
 * @return The generated unique identifier string.
 */
export function generateSimpleUID ( baseTime:number = 1730000000000, timeEntropy:number = 8, randomEntropy:number = 16, radix:number = 36 ):string {
  const date = Math.round((Date.now() - baseTime) * timeEntropy).toString(radix)
  if ( randomEntropy == 0 )
    return date
  const random = Math.random().toString(radix).substring(2, randomEntropy)
  return `${date}${random}`
}

/**
 * Random integer between min to max
 */
export const randomInt = (min:number, max:number) => Math.round(randomRange(min, max));

/**
 * Random number between min and max
 */
export const randomRange = (min:number, max:number) => (min + Math.random() * (max - min));


const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.+=';

export function createUniqueID ( length = 16 ) {
  let buffer = ''
  for ( let i = 0; i < length; i++ ) {
    const index = randomInt( 0, base64Alphabet.length - 1 )
    buffer += base64Alphabet[ index ]
  }
  return buffer
}
