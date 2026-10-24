import type { Database } from 'sql.js'
import { rows, sqlString } from './sql'
import type { Row } from './types'

export class MobileSyncRepository {
  constructor(private readonly db: Database, private readonly persist: () => void) {}

  listUsage(): Row[] {
    return rows(this.db, 'SELECT event_id,post_id,target_id,action,used_at,device_id,format_version,imported_at FROM mobile_usage_events ORDER BY used_at')
  }

  hasEvent(eventId: string): boolean {
    return rows(this.db, `SELECT event_id FROM mobile_usage_events WHERE event_id = ${sqlString(eventId)}`).length > 0
  }

  recordUsage(event: { eventId: string; postId: string; targetId: string; action: 'used'; usedAt: string; deviceId: string; version: number }) {
    const existing = this.hasEvent(event.eventId)
    if (existing) return false
    this.db.run(
      `INSERT INTO mobile_usage_events
        (event_id,post_id,target_id,action,used_at,device_id,format_version,imported_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [event.eventId, event.postId, event.targetId, event.action, event.usedAt, event.deviceId, event.version, new Date().toISOString()],
    )
    this.persist()
    return true
  }
}
