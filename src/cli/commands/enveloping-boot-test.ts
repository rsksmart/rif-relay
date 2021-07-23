import commander from 'commander'
import { envelopingCommander, saveDeployment, showDeployment } from '../utils'
import { TestEnvironment } from '../../TestEnvironment'

envelopingCommander(['n'])
  .option('-w, --workdir <directory>', 'relative work directory (defaults to build/enveloping/)', 'build/enveloping')
  .parse(process.argv);

(async () => {
  try {
    const network: string = commander.network
    const env = await TestEnvironment.start(network)
    saveDeployment(env.deploymentResult, commander.workdir)
    showDeployment(env.deploymentResult, 'Enveloping started')

    console.log(`Relay is active, URL = ${env.relayUrl} . Press Ctrl-C to abort`)
  } catch (e) {
    console.error(e)
  }
})().catch(
  reason => {
    console.error(reason)
    process.exit(1)
  }
)
