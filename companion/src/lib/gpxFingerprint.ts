import { computeGpxFingerprint } from "@shared/api/importGpx";

export async function fingerprintGpxFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  return computeGpxFingerprint(bytes);
}

export async function fingerprintGpxBytes(bytes: ArrayBuffer): Promise<string> {
  return computeGpxFingerprint(bytes);
}
