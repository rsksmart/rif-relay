#!/usr/bin/env node

import commander from 'commander'
import { version } from '../../../package.json'

commander
  .version(version)
  .command('start', 'all-on-one: deploy all contracts, start relay')
  .command('deploy', 'deploy RelayHub and other GSN contracts instances')
  .command('relayer-register', 'stake for a relayer and fund it')
  .command('relayer-run', 'launch a relayer server')
  .command('verifier-fund', 'fund a verifier contract so it can pay for relayed calls')
  .command('verifier-balance', 'query a verifier GSN balance')
  .command('status', 'status of the GSN network')
  .command('registry', 'VersionRegistry management')
  .parse(process.argv)
