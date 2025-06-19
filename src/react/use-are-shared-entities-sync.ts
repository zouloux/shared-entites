import { useEffect, useState } from 'react'
import { TClientSharedEntities } from "../client/shared-entities.client.js";

export function useAreSharedEntitiesSync ( sharedEntities:TClientSharedEntities ) {
  const [isSync, setIsSync] = useState(sharedEntities.isStarted)
  useEffect(() => {
    return sharedEntities.onSynced.add((v) => {
      setIsSync(v)
    })
  }, [])
  return isSync
}
