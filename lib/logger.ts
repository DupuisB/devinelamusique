export function info(msg: string, meta?: any) {
  try { console.log(`[info] ${new Date().toISOString()} - ${msg}`, meta ?? '') } catch {}
}

export function warn(msg: string, meta?: any) {
  try { console.warn(`[warn] ${new Date().toISOString()} - ${msg}`, meta ?? '') } catch {}
}

export function error(msg: string, meta?: any) {
  try { console.error(`[error] ${new Date().toISOString()} - ${msg}`, meta ?? '') } catch {}
}
