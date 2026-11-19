import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DeviceScanTarget, type DeviceSnapshot } from "../../api";

const empty: DeviceSnapshot = {
  inputs: [],
  outputs: [],
  vst3: [],
  revision: -1,
  ready: false,
  refreshing: false,
  inputError: null,
  outputError: null,
};
interface Scope {
  engineId: string | undefined;
  sequence: number;
  accepted: number;
  errorRequest: number;
  pending: number;
  catalogId: string | undefined;
  revision: number;
  retired: Set<string>;
  manual: Set<DeviceScanTarget>;
}

/** Every engine connection owns its requests and cursor; a late old reply cannot restore its devices. */
export function useDeviceCatalog(engineId?: string) {
  const [devices, setDevices] = useState(empty);
  const [deviceError, setDeviceError] = useState("");
  const [requesting, setRequesting] = useState<ReadonlySet<DeviceScanTarget>>(
    new Set(),
  );
  const scope = useRef<Scope | null>(null);
  const wanted = useRef(engineId);
  wanted.current = engineId;
  const refreshDevices = useCallback(
    async (rescan = false, target: DeviceScanTarget = "all") => {
      const current = scope.current;
      if (
        !current ||
        current.engineId !== engineId ||
        wanted.current !== engineId ||
        (current.manual.has(target) && rescan)
      )
        return;
      const request = ++current.sequence;
      current.pending++;
      if (rescan) {
        current.manual.add(target);
        setRequesting(new Set(current.manual));
      }
      const active = () =>
        scope.current === current && wanted.current === current.engineId;
      try {
        const next = await api.devices(rescan, target);
        if (
          !active() ||
          (next.catalogId && current.retired.has(next.catalogId))
        )
          return;
        const changedCatalog = next.catalogId !== current.catalogId;
        if (
          (changedCatalog && request < current.accepted) ||
          (!changedCatalog && next.revision < current.revision)
        )
          return;
        if (changedCatalog && current.catalogId)
          current.retired.add(current.catalogId);
        current.catalogId = next.catalogId;
        current.revision = next.revision;
        current.accepted = Math.max(current.accepted, request);
        setDevices((previous) =>
          previous.catalogId === next.catalogId &&
          previous.revision === next.revision &&
          previous.refreshing === next.refreshing
            ? previous
            : next,
        );
        if (request >= current.errorRequest) setDeviceError("");
      } catch (error) {
        if (
          active() &&
          request >= current.accepted &&
          request >= current.errorRequest
        ) {
          current.errorRequest = request;
          setDeviceError(
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        current.pending--;
        if (rescan) {
          current.manual.delete(target);
          if (active()) setRequesting(new Set(current.manual));
        }
      }
    },
    [engineId],
  );
  useEffect(() => {
    const current: Scope = {
      engineId,
      sequence: 0,
      accepted: 0,
      errorRequest: 0,
      pending: 0,
      catalogId: undefined,
      revision: -1,
      retired: new Set(),
      manual: new Set(),
    };
    scope.current = current;
    setDevices(empty);
    setDeviceError("");
    setRequesting(new Set());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (scope.current !== current) return;
      if (current.pending === 0) await refreshDevices();
      if (scope.current === current) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      if (scope.current === current) scope.current = null;
      clearTimeout(timer);
    };
  }, [engineId, refreshDevices]);
  const current = scope.current !== null && scope.current.engineId === engineId;
  return {
    devices: current ? devices : empty,
    deviceError: current ? deviceError : "",
    refreshDevices,
    requesting: current ? requesting : new Set<DeviceScanTarget>(),
  };
}
