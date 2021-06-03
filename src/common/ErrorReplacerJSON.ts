export default function replaceErrors (key: string, value: { [key: string]: any }): any {
  if (value instanceof Map) {
    return {
      dataType: 'Map',
      value: Array.from(value.entries())
    }
  } else if (value instanceof Error) {
    const error: { [key: string]: any } = {}

    // remove "circular referenced" objects we don't really want to log...
    Object.getOwnPropertyNames(value).filter(e => !['request', 'response'].includes(e)).forEach(function (key) {
      error[parseInt(key)] =
        // @ts-ignore
        value[parseInt(key)]
    })

    return error
  }

  return value
}
