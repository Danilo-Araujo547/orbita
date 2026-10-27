import { useCallback, useEffect, useRef, useState } from "react";
import { query, request } from "../../../api";
import type { CanvasAssetMeta, CanvasPage } from "../model";
import { UUID_RE, base64ToBlob, inferImageMime } from "../model";

export function useAssetUrls({
  reportId,
  unit,
  assets,
  pages,
}: {
  reportId: number;
  unit: string;
  assets: CanvasAssetMeta[];
  pages: CanvasPage[];
}) {
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const downloadUrlsRef = useRef<Set<string>>(new Set());
  const fetchingAssetsRef = useRef<Set<string>>(new Set());

  const registerAssetBlob = useCallback(
    (assetId: string, b64: string, filename: string, mime?: string) => {
      try {
        const blob = base64ToBlob(b64, inferImageMime(filename, b64, mime));
        const nextUrl = URL.createObjectURL(blob);
        const prevUrl = objectUrlsRef.current.get(assetId);
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        objectUrlsRef.current.set(assetId, nextUrl);
        setAssetUrls((curr) => ({ ...curr, [assetId]: nextUrl }));
      } catch {
        // Ignore malformed base64 preview without crashing editor
      }
    },
    [],
  );

  const registerAssetsBatch = useCallback(
    (incomingAssets: CanvasAssetMeta[]) => {
      for (const a of incomingAssets) {
        if (a.content) {
          registerAssetBlob(a.id, a.content, a.filename, a.mime);
        }
      }
    },
    [registerAssetBlob],
  );

  const trackDownloadUrl = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    downloadUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeDownloadUrl = useCallback((url?: string) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    downloadUrlsRef.current.delete(url);
  }, []);

  useEffect(() => {
    const assetMap = objectUrlsRef.current;
    const dlSet = downloadUrlsRef.current;
    return () => {
      for (const url of assetMap.values()) URL.revokeObjectURL(url);
      assetMap.clear();
      for (const url of dlSet.values()) URL.revokeObjectURL(url);
      dlSet.clear();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const knownIds = new Set(assets.map((a) => a.id));
    for (const p of pages) {
      for (const b of p.blocks) {
        if (b.type === "image" && b.asset_id && UUID_RE.test(b.asset_id)) {
          knownIds.add(b.asset_id);
        }
      }
    }
    for (const assetId of knownIds) {
      if (objectUrlsRef.current.has(assetId) || fetchingAssetsRef.current.has(assetId)) {
        continue;
      }
      fetchingAssetsRef.current.add(assetId);
      request<CanvasAssetMeta>(
        query(`reports/${reportId}/canvas-assets`, { unit, asset_id: assetId }),
      )
        .then((res) => {
          if (alive && res?.content) {
            registerAssetBlob(
              res.id || assetId,
              res.content,
              res.filename || "asset.png",
              res.mime,
            );
          }
        })
        .catch(() => {
          // Asset fetch error handled gracefully on block placeholder
        })
        .finally(() => {
          fetchingAssetsRef.current.delete(assetId);
        });
    }
    return () => {
      alive = false;
    };
  }, [assets, pages, reportId, unit, registerAssetBlob]);

  return {
    assetUrls,
    registerAssetBlob,
    registerAssetsBatch,
    trackDownloadUrl,
    revokeDownloadUrl,
  };
}
