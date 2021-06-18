import HttpWrapper from '../src/relayclient/HttpWrapper'
import { expect, assert } from 'chai'
import { network } from 'hardhat'

describe('HttpWrapper', () => {
  it('connect to node, get version', async () => {
    const http = new HttpWrapper()
    // @ts-ignore
    const url = network.config.url
    const res = await http.sendPromise(url, {
      jsonrpc: '2.0',
      method: 'net_version',
      id: 123
    })

    expect(123).to.be.equal(res.id, JSON.stringify(res)) // just verify its a valid response
  })

  it('should fail on connection refused', async () => {
    const http = new HttpWrapper()
    try {
      await http.sendPromise('http://localhost:44321', {
        jsonrpc: '2.0',
        method: 'net_version',
        id: 123
      })
      assert.fail()
    } catch (error) {
      expect(error.toString()).to.include('connect ECONNREFUSED 127.0.0.1:44321')
    }
  })
})
