/**
 * Generates a simple unique identifier (UID) based on the current time and random entropy.
 * @param baseTime - The base timestamp value used to calculate the UID relative time.
 * 									Can be Date.now() gathered at server start.
 * 									This value should not move while server is running.
 * @param entropySize - The number of random characters to include in the UID. Max is 12.
 * @param radix - The base or radix for converting numeric values to strings. Defaults to 36.
 * @return The generated unique identifier string.
 */
export function generateSimpleUID ( baseTime:number = 1730000000000, entropySize:number = 4, radix:number = 36 ):string {
  const date = (Date.now() - baseTime).toString(radix)
  const random = Math.random().toString(radix).substring(1, entropySize)
  return date + random
}
