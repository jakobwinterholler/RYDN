import { useEffect, useRef } from "react";
import { useAuth } from "@shared/auth/AuthProvider";
import { getFreshAccessToken } from "@shared/auth/accessToken";
import { pushAllLocalRaces } from "@shared/api/sync";
import { updateDeviceLastActive } from "@shared/sync/deviceProfile";
import { setAuthAccessToken } from "../api/authFetch";
import { recordSyncFailure, recordSyncSuccess } from "./useAccountSync";
import { setSyncUserId } from "./syncUserContext";

const IMPORTED_KEY = "cloud-sync-imported";

export function AuthSyncBridge() {
  const { accessToken, user, configured } = useAuth();
  const importedRef = useRef(false);

  useEffect(() => {
    setAuthAccessToken(accessToken);
    setSyncUserId(user?.id ?? null);
  }, [accessToken, user?.id]);

  useEffect(() => {
    if (!configured || !accessToken || !user || importedRef.current) {
      return;
    }
    const alreadyImported = localStorage.getItem(`${IMPORTED_KEY}:${user.id}`) === "1";
    if (alreadyImported) {
      importedRef.current = true;
      return;
    }

    importedRef.current = true;
    void updateDeviceLastActive("desktop");
    void getFreshAccessToken(accessToken)
      .then((token) => pushAllLocalRaces(token, user?.id))
      .then((result) => {
        localStorage.setItem(`${IMPORTED_KEY}:${user.id}`, "1");
        recordSyncSuccess(user.id);
        if (result.failed.length > 0) {
          recordSyncFailure(
            user.id,
            result.failed.map((entry) => entry.race_id),
          );
        }
      })
      .catch(() => {
        importedRef.current = false;
      });
  }, [accessToken, configured, user]);

  return null;
}
