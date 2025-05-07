import { useLayoutEffect, useState } from 'react'
import { TClientSharedEntities } from "../client/shared-entities.client.js";


export function useSharedList
  <GType>
  (sharedEntities:TClientSharedEntities, appId: number, key: string): GType[]
{
  const [value, setValue] = useState<GType[]>(
    () => sharedEntities.getValue(appId, key) ?? []
  )
  useLayoutEffect(() => {
    return sharedEntities.onUpdated.add(
      (eventAppId: number, eventKey: string) => {
        if (eventAppId === appId && eventKey === key) {
          const value = sharedEntities.getValue(appId, key) ?? []
          setValue([...value])
        }
      }
    )
  }, [appId, key])
  return value
}
