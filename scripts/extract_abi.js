#!/usr/bin/env node

// extract ABI from compiled files

const fs = require('fs')
const path = require('path')

// TODO: pass all these things as parameters
const outAbiFolder = 'src/common'
const contractsFolderToExtract = './contracts/interfaces'

const files = fs.readdirSync(contractsFolderToExtract)
// files.push('IForwarder.sol')
// files.push('IWalletFactory.sol')

files.forEach(file => {
  const c = 'interfaces/' + file.replace(/.sol/, '')
  const outNodeFile = outAbiFolder + '/' + c + '.json'
  const jsonFile = './artifacts/contracts/' + c + '.sol/' + `${c.replace(/interfaces./, '')}.json`
  const abiStr = JSON.parse(fs.readFileSync(jsonFile, { encoding: 'ascii' }))
  fs.mkdirSync(path.dirname(outNodeFile), { recursive: true })
  fs.writeFileSync(outNodeFile, JSON.stringify(abiStr.abi))
  console.log('written "' + outNodeFile + '"')
})
