import fs from 'node:fs'
import { createHash } from 'node:crypto'
import initSqlJs, { Database } from 'sql.js'
import { defaultIdeaAnalysisOptions, type IdeaAnalysisOptions, type IdeaAnalysisProgress, type Row } from './database/types'
import { ensureCatalogColumns } from './database/schema-repair'
import { DatabasePersistence } from './database/persistence'
import { MediaRepository } from './database/media-repository'
import { PreferencesRepository } from './database/preferences-repository'
import { ConceptLinksRepository } from './database/concept-links-repository'
import { SourcesRepository } from './database/sources-repository'
import { PostsRepository } from './database/posts-repository'
import { IdeasRepository } from './database/ideas-repository'
import { AnalysisRepository } from './database/analysis-repository'
import { CatalogRepository } from './database/catalog-repository'
import { ExportsRepository } from './database/exports-repository'
import { SourceImportRepository } from './database/source-import-repository'
import { IdeaPostWorkflowRepository } from './database/idea-post-workflow-repository'
import { WorkGroupsRepository } from './database/work-groups-repository'
import { MediaCompressionRepository } from './database/media-compression-repository'
import { MobileSyncRepository } from './database/mobile-sync-repository'
import type { MediaCompressionCandidate } from './database/media-compression-repository'
import { runMigrations } from './database/migration-runner'
import { seedDatabase } from './database/seed'

export class PlannerDatabase {
  private db!: Database
  private readonly existedAtStartup: boolean
  private persistence!: DatabasePersistence
  private media!: MediaRepository
  private preferences!: PreferencesRepository
  private conceptLinks!: ConceptLinksRepository
  private sources!: SourcesRepository
  private posts!: PostsRepository
  private ideas!: IdeasRepository
  private analysis!: AnalysisRepository
  private catalog!: CatalogRepository
  private exports!: ExportsRepository
  private sourceImports!: SourceImportRepository
  private ideaPostWorkflows!: IdeaPostWorkflowRepository
  private workGroups!: WorkGroupsRepository
  private mediaCompression!: MediaCompressionRepository
  private mobileSync!: MobileSyncRepository

  constructor(
    private readonly filePath: string,
    private readonly wasmPath: string,
    private readonly backupsDirectory: string,
  ) {
    this.existedAtStartup = fs.existsSync(filePath)
  }

  async init() {
    const SQL = await initSqlJs({ locateFile: () => this.wasmPath })
    this.db = this.existedAtStartup ? new SQL.Database(fs.readFileSync(this.filePath)) : new SQL.Database()
    this.persistence = new DatabasePersistence(this.db, this.filePath, this.backupsDirectory)
    this.media = new MediaRepository(this.db, () => this.persist())
    this.preferences = new PreferencesRepository(this.db, () => this.persist())
    this.conceptLinks = new ConceptLinksRepository(this.db, () => this.persist())
    this.sources = new SourcesRepository(this.db, () => this.persist())
    this.posts = new PostsRepository(this.db, () => this.persist(), (type, entity, entityId, payload, at) => this.recordEvent(type, entity, entityId, payload, at))
    this.workGroups = new WorkGroupsRepository(this.db, () => this.persist())
    this.mediaCompression = new MediaCompressionRepository(this.db, () => this.persist())
    this.mobileSync = new MobileSyncRepository(this.db, () => this.persist())
    this.ideas = new IdeasRepository(this.db, () => this.persist(), (title, body) => this.ideaHash(title, body), (type, entity, entityId, payload, at) => this.recordEvent(type, entity, entityId, payload, at))
    this.analysis = new AnalysisRepository(
      this.db,
      () => this.ideas.list(),
      id => this.ideas.get(id),
      (title, body) => this.ideaHash(title, body),
      () => this.persist(),
      this.filePath,
      (type, entity, entityId, payload, at) => this.recordEvent(type, entity, entityId, payload, at),
    )
    this.catalog = new CatalogRepository(this.db, () => this.persist())
    this.exports = new ExportsRepository(this.db, () => this.persist())
    this.sourceImports = new SourceImportRepository(
      this.db,
      () => this.persist(),
      id => this.sources.get(id),
      sourceId => this.sources.listRecords(sourceId),
      id => this.posts.get(id),
      id => this.ideas.get(id),
    )
    this.ideaPostWorkflows = new IdeaPostWorkflowRepository(
      this.db,
      () => this.persist(),
      id => this.posts.get(id),
      id => this.ideas.get(id),
      (type, entity, entityId, payload, at) => this.recordEvent(type, entity, entityId, payload, at),
    )
    runMigrations(this.db, this.existedAtStartup, () => this.persistence.createBackup('before-migration'))
    ensureCatalogColumns(this.db, () => this.persist(), (title, body) => this.ideaHash(title, body))
    if (!this.existedAtStartup && this.count() === 0) seedDatabase(input => this.save(input))
    this.persist()
    this.flush()
  }

  private ideaHash(title: string, body: string) {
    void title
    const normalized = body.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
    return createHash('sha256').update(normalized).digest('hex')
  }

  createBackup(reason: 'before-migration' | 'before-update' | 'manual' = 'manual') {
    return this.persistence.createBackup(reason)
  }

  list(): Row[] {
    return this.posts.list()
  }

  listWorkGroups(): Row[] { return this.workGroups.list() }
  saveWorkGroup(input: Row): Row { return this.workGroups.save(input) }
  setWorkGroupPosts(id: string, postIds: string[]): Row { return this.workGroups.setPosts(id, postIds) }
  setWorkGroupArchived(id: string, archived: boolean): Row { return this.workGroups.setArchived(id, archived) }
  removeWorkGroup(id: string) { this.workGroups.remove(id) }
  compressMedia(targetType: 'group' | 'post', targetId: string, candidates: MediaCompressionCandidate[], references: Map<string, Set<string>>, includedPostIds: Set<string>, archiveDirectory: string, managedRoot: string) {
    return this.mediaCompression.compress(targetType, targetId, candidates, references, includedPostIds, archiveDirectory, managedRoot)
  }
  restoreMedia(assetIds: string[], managedRoot: string) { return this.mediaCompression.restore(assetIds, managedRoot) }
  compressedMediaIds() { return this.mediaCompression.compressedIds() }
  compressedMediaIdsForTarget(targetType: 'group' | 'post', targetId: string) { return this.mediaCompression.assetIdsForTarget(targetType, targetId) }
  getMediaCompressionState(id: string) { return this.mediaCompression.state(id) }

  savePreferences(entries: Record<string, string>) {
    this.preferences.save(entries)
  }

  removePreference(key: string) {
    this.preferences.remove(key)
  }

  listPreferences() {
    return this.preferences.list()
  }

  projectForPost(id: string): string | undefined {
    return this.posts.project(id)
  }

  save(input: Row): Row {
    return this.posts.save(input, id => this.ideas.get(id))
  }

  listSources(): Row[] { return this.sources.list() }

  getSource(id: string): Row | undefined { return this.sources.get(id) }

  saveSource(input: Row): Row {
    return this.sources.save(input)
  }

  removeSource(id: string) {
    this.sources.remove(id)
  }

  listSourceDefinitions(sourceId?: string): Row[] {
    return this.sources.listDefinitions(sourceId)
  }

  getSourceDefinition(id: string): Row | undefined { return this.sources.getDefinition(id) }

  saveSourceDefinition(input: Row): Row {
    return this.sources.saveDefinition(input)
  }

  listContentRecords(sourceId?: string): Row[] {
    return this.sources.listRecords(sourceId)
  }

  getContentRecordForPost(postId: string): Row | undefined {
    return this.sources.getRecordForPost(postId)
  }

  getPost(id: string): Row | undefined { return this.posts.get(id) }

  listMobileUsage(): Row[] { return this.mobileSync.listUsage() }
  hasMobileUsageEvent(eventId: string): boolean { return this.mobileSync.hasEvent(eventId) }
  recordMobileUsage(event: { eventId: string; postId: string; targetId: string; action: 'used' | 'removed'; usedAt: string; deviceId: string; version: number }) {
    return this.mobileSync.recordUsage(event)
  }
  listMobileAlbumCleanup(): Row[] { return this.mobileSync.listAlbumCleanup() }
  recordMobileAlbumCleanup(event: { eventId: string; postId: string; title: string; folderName: string; batch: string; spaceName: string; spaceOrder: number | null; reason: string; occurredAt: string }) {
    return this.mobileSync.recordAlbumCleanup(event)
  }

  getCatalogConfig(scope = ''): Row | undefined { return this.catalog.getConfig(scope) }
  saveCatalogConfig(input: Row): Row { return this.catalog.saveConfig(input) }
  getCatalogPostFields(postId: string): Row | undefined { return this.catalog.getPostFields(postId) }
  saveCatalogPostFields(input: Row): Row { return this.catalog.savePostFields(input) }
  getCatalogSync(postId: string): Row | undefined { return this.catalog.getSync(postId) }
  saveCatalogSync(input: Row): Row { return this.catalog.saveSync(input) }

  saveContentEnriched(id: string, enrichedJson: string): Row {
    return this.sources.saveEnriched(id, enrichedJson)
  }

  listContentTypeTemplates(): Row[] { return this.exports.listContentTypeTemplates() }
  saveContentTypeTemplate(input: Row): Row { return this.exports.saveContentTypeTemplate(input) }
  listExportProfiles(): Row[] { return this.exports.listProfiles() }
  getExportProfile(id: string): Row | undefined { return this.exports.getProfile(id) }
  saveExportProfile(input: Row): Row { return this.exports.saveProfile(input) }
  listExportRows(sourceId?: string, project?: string): Row[] { return this.exports.listRows(sourceId, project) }
  listLastExportSnapshot(profileId: string, sourceId?: string, scope = ''): Row[] { return this.exports.listLastSnapshot(profileId, sourceId, scope) }
  saveExportSnapshot(profileId: string, sourceId: string | undefined, scope: string, mode: string, items: { rowKey: string; rowHash: string }[]) { this.exports.saveSnapshot(profileId, sourceId, scope, mode, items) }

  applyImport(sourceId: string, items: Row[]) {
    return this.sourceImports.applyImport(sourceId, items)
  }

  applySourceDestination(sourceId: string) {
    return this.sourceImports.applySourceDestination(sourceId)
  }

  remove(id: string) {
    this.posts.remove(id)
  }

  reassignProject(fromProject: string, toProject: string) {
    this.posts.reassignProject(fromProject, toProject)
  }

  listIdeas(): Row[] {
    return this.ideas.list()
  }

  saveIdea(input: Row, shouldPersist = true): Row {
    return this.ideas.save(input, shouldPersist)
  }

  saveIdeasMany(inputs: Row[]) {
    return this.ideas.saveMany(inputs)
  }

  listIdeaImportRuns() {
    return this.ideas.listImportRuns()
  }

  removeIdea(id: string) {
    return this.ideas.remove(id)
  }

  convertIdea(id: string): { idea: Row; post: Row } { return this.ideaPostWorkflows.convertIdea(id) }
  combineIdeas(ids: string[]): { ideas: Row[]; post: Row } { return this.ideaPostWorkflows.combineIdeas(ids) }
  uncombinePost(postId: string): { ideas: Row[]; post: Row } { return this.ideaPostWorkflows.uncombinePost(postId) }

  listEvents(entity?: string, entityId?: string): Row[] {
    return this.analysis.listEvents(entity, entityId)
  }

  refreshIdeaEmbeddings(ids?: string[], ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions) {
    return this.analysis.refreshIdeaEmbeddings(ids, ignoredTerms, options)
  }
  listIdeaNeighbors(id: string, limit = 8, ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions) {
    return this.analysis.listIdeaNeighbors(id, limit, ignoredTerms, options)
  }
  proposeIdeaClusters(threshold = 0.65, ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions, onProgress?: (progress: IdeaAnalysisProgress) => void) {
    return this.analysis.proposeIdeaClusters(threshold, ignoredTerms, options, onProgress)
  }
  previewIdeaAnalysis(ignoredTerms: string[] = [], options: IdeaAnalysisOptions = defaultIdeaAnalysisOptions) {
    return this.analysis.previewIdeaAnalysis(ignoredTerms, options)
  }

  listIdeaClusters(): Array<{ id: string; name: string; algorithm: string; model: string; model_version: string; calculated_at: string; ideaIds: string[]; memberScores: number[] }> {
    return this.analysis.listClusters()
  }

  private recordEvent(type: string, entity: string, entityId: string, payload: Record<string, unknown>, createdAt = new Date().toISOString()) {
    this.db.run('INSERT INTO events (id,type,entity,entity_id,payload,created_at) VALUES (?,?,?,?,?,?)', [crypto.randomUUID(), type, entity, entityId, JSON.stringify(payload), createdAt])
  }

  listConceptMap(): { nodes: Row[]; links: Row[]; folders: Row[] } {
    return this.conceptLinks.list()
  }

  saveConceptNode(input: Row): Row {
    return this.conceptLinks.saveNode(input)
  }

  removeConceptNode(id: string) {
    this.conceptLinks.removeNode(id)
  }

  saveConceptLink(input: Row): Row {
    return this.conceptLinks.save(input)
  }

  removeConceptLink(id: string) {
    this.conceptLinks.remove(id)
  }

  saveConceptFolder(input: Row): Row {
    return this.conceptLinks.saveFolder(input)
  }

  removeConceptFolder(id: string): { parentId: string | null } {
    return this.conceptLinks.removeFolder(id)
  }

  listMedia(): Row[] {
    return this.media.list()
  }

  getMediaPath(id: string): string | undefined {
    return this.media.getPath(id)
  }

  findMediaByPath(filePath: string): Row | undefined {
    return this.media.findByPath(filePath)
  }

  updateMediaPath(id: string, filePath: string) {
    this.media.updatePath(id, filePath)
  }

  getMediaFile(id: string): { path: string; kind: string; mode: string; archivePath?: string; entryName?: string } | undefined {
    return this.media.getFile(id)
  }

  saveMedia(assets: Row[]) {
    this.media.save(assets)
  }

  private count() { return Number(this.db.exec('SELECT COUNT(*) AS n FROM posts')[0]?.values[0]?.[0] || 0) }

  flush() {
    this.persistence.flush()
  }

  async reopenFromDisk() {
    const replacement = new PlannerDatabase(this.filePath, this.wasmPath, this.backupsDirectory)
    await replacement.init()
    return replacement
  }

  private persist() {
    this.persistence.queue()
  }

}
