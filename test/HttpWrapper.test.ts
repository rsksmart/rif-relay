import {
  HttpWrapper
} from '@rsksmart/rif-relay-client'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

const { expect, assert } = chai.use(chaiAsPromised)

describe('HttpWrapper', () => {
  it('connect to node, get version', async () => {
    const http = new HttpWrapper()
    // @ts-ignore
    const url = web3.currentProvider.host
    const res = await http.sendPromise(url, {
      jsonrpc: '2.0',
      method: 'net_version',
      id: 123
    })

    assert.equal(123, res.id, JSON.stringify(res)) // just verify its a valid response
  })

  it('should fail on connection refused', async () => {
    const http = new HttpWrapper()
    const res = http.sendPromise('http://localhost:44321', {
      jsonrpc: '2.0',
      method: 'net_version',
      id: 123
    })
    // @ts-ignore
    await expect(res).to.be.eventually.rejectedWith({ error: 'connect ECONNREFUSED 127.0.0.1:44321' })
  })
})
