const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const tempDir = process.argv[2]
if (!tempDir) throw new Error('runner temp directory is required')

const workDir = path.join(tempDir, 'git-prepare')
const stdoutPath = path.join(tempDir, 'issue-90-git-prepare.stdout.log')
const stderrPath = path.join(tempDir, 'issue-90-git-prepare.stderr.log')
const logPath = path.join(tempDir, 'issue-90-git-prepare.log')

fs.mkdirSync(workDir, { recursive: true })
fs.writeFileSync(
  path.join(workDir, 'package.json'),
  `${JSON.stringify({ private: true }, null, 2)}\n`,
)

const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
const command = 'pnpm add "github:omdsh-dev/dsh-genui#6298f8ca"'
const result = spawnSync(comspec, ['/d', '/s', '/c', command], {
  cwd: workDir,
  encoding: 'utf8',
  stdio: 'pipe',
  maxBuffer: 64 * 1024 * 1024,
})

const stdout = result.stdout || ''
const stderr = result.stderr || ''
const status = result.status ?? -1
const errorText = result.error
  ? `${result.error.name}: ${result.error.message}\n`
  : ''
const combined = [
  '=== spawn metadata ===',
  `command=${comspec} /d /s /c ${command}`,
  `status=${status}`,
  `signal=${result.signal || ''}`,
  `error=${errorText.trim()}`,
  '=== stdout ===',
  stdout,
  '=== stderr ===',
  stderr,
].join('\n')

fs.writeFileSync(stdoutPath, stdout)
fs.writeFileSync(stderrPath, `${errorText}${stderr}`)
fs.writeFileSync(logPath, combined)
process.stdout.write(combined)

const esbuildEmpty = /Expected ".*" but got ""/.test(combined)
const prepackEinval = /prepack/i.test(combined) && /EINVAL/.test(combined)
const gitPrepareNotAllowed = /ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED/.test(combined)

console.log(`\npnpm exit=${status}`)
console.log(`esbuild empty stdout=${esbuildEmpty}`)
console.log(`prepack EINVAL=${prepackEinval}`)
console.log(`git prepare not allowed=${gitPrepareNotAllowed}`)

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `pnpm_exit=${status}`,
      `esbuild_empty=${esbuildEmpty}`,
      `prepack_einval=${prepackEinval}`,
      `git_prepare_not_allowed=${gitPrepareNotAllowed}`,
      '',
    ].join('\n'),
  )
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const signatures = combined
    .split(/\r?\n/)
    .filter((line) =>
      /Expected .* but got|esbuild|EINVAL|ERR_PNPM_PREPARE_PACKAGE|ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED|prepack/.test(
        line,
      ),
    )

  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '## Historical git prepare',
      '',
      `- Node: \`${process.version}\``,
      `- source: \`github:omdsh-dev/dsh-genui#6298f8ca\``,
      `- pnpm exit: \`${status}\``,
      `- esbuild empty stdout: \`${esbuildEmpty}\``,
      `- prepack EINVAL: \`${prepackEinval}\``,
      `- git prepare not allowed: \`${gitPrepareNotAllowed}\``,
      '',
      'Key signatures:',
      '```text',
      ...signatures,
      '```',
      '',
    ].join('\n'),
  )
}

// A failing historical install is investigation data. Only this harness itself
// should fail the workflow, so always exit successfully after classification.
process.exit(0)
