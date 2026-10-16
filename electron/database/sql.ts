import type { Database } from 'sql.js'
import type { Row } from './types'

export function sqlString(value: string) {
  return "'" + value.replaceAll("'", "''") + "'"
}

export function rows(db: Database, sql: string): Row[] {
  const result = db.exec(sql)
  if (!result[0]) return []
  return result[0].values.map(values => Object.fromEntries(result[0].columns.map((key, index) => [key, values[index]])))
}

export function firstRow(db: Database, sql: string): Row | undefined {
  return rows(db, sql).at(0)
}
