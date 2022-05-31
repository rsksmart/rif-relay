import childProcess from 'child_process'
import path from 'path'
import fs from 'fs'

describe('RelayServer-webpack', () => {
  let oneFileRelayer: string
  before('create webpack', function () {
    this.timeout(15000)
    const jsrelayDir = path.join(__dirname, '../../dockers', 'jsrelay')
    try {
      /*
       * It raises an error if the folder doesn't exist on macos.
       * If we decide to drop the support for node version minor than v14.14.0
       * we could use [fs.rmDir](https://nodejs.org/docs/latest-v16.x/api/fs.html#fsrmsyncpath-options).
       */
      fs.rmdirSync(path.join(jsrelayDir, 'dist'), { recursive: true })
    } catch (error) {
      console.log(`deletion of ${path.join(jsrelayDir, 'dist')} failed. Folder not found`)
    }
    childProcess.execSync('npx webpack', { cwd: jsrelayDir, stdio: 'inherit' })
    oneFileRelayer = path.join(jsrelayDir, 'dist', 'relayserver.js')
  })

  it('should launch (and instantly crash with some parameter missing) to verify it was packed correctly', function () {
    try {
      childProcess.execSync('node ' + oneFileRelayer, { encoding: 'ascii', stdio: 'pipe' })
      assert.fail('should throw')
    } catch (e) {
      assert.match(e.message.toString(), /missing rskNodeUrl/)
    }
  })

  it('should test it can actually work')
})
