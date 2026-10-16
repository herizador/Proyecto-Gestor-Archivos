// Formato corto de bytes: GB con decimal a partir de 1 GB, MB por debajo
// (0,03 GB se veía como "0,0 GB" y parecía no actualizarse).
export function formatoCorto(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
