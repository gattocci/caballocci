import fs from 'node:fs'
import path from 'node:path'

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const explicitTag = process.argv.slice(2).find(argument => !argument.startsWith('--'))
const tag = process.env.GITHUB_REF_NAME || explicitTag || `v${packageJson.version}`
if (!tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error(`Etiqueta SemVer inválida: ${tag || '(vacía)'}`)
}
if (tag.slice(1) !== packageJson.version) {
  throw new Error(`La etiqueta ${tag} no coincide con package.json (${packageJson.version}).`)
}

const releaseDirectory = path.resolve('release')
if (process.argv.includes('--artifacts')) {
  const names = fs.readdirSync(releaseDirectory)
  const required = [
    name => /^caballocci-Setup-.*-x64\.exe$/.test(name),
    name => /^caballocci-Setup-.*-x64\.exe\.blockmap$/.test(name),
    name => name === 'latest.yml',
  ]
  if (!required.every(match => names.some(match))) {
    throw new Error(`Faltan artefactos de actualización en release/: ${names.join(', ')}`)
  }
  console.log(names.filter(name => /(?:\.exe|\.blockmap|latest\.yml)$/.test(name)).join('\n'))
}
