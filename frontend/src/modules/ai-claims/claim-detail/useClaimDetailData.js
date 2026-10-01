import React from "react";
import { ClaimsApi } from "../../../api/claims.js";

export function useClaimDetailData(id, locationKey) {
  const [claim, setClaim] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async ({ silent = false } = {}) => {
    if (!id) {
      setLoading(false);
      return null;
    }

    if (!silent) setLoading(true);

    try {
      const data = await ClaimsApi.get(id);
      setClaim(data);
      return data;
    } catch (error) {
      if (!silent) setClaim(null);
      throw error;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    load().catch(() => {});
  }, [load]);

  React.useEffect(() => {
    if (!id) return undefined;

    const refresh = () => {
      load({ silent: true }).catch(() => {});
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [id, load]);

  React.useEffect(() => {
    if (!id) return;
    load({ silent: true }).catch(() => {});
  }, [id, load, locationKey]);

  return {
    claim,
    setClaim,
    loading,
    load
  };
}
