import { expect } from 'chai'
import { ethers } from 'hardhat'
import { TestRSKAddressValidator, TestRSKAddressValidator__factory } from '../typechain'
  
describe('RSKAddressValidator', () => {
  let addressValidator: TestRSKAddressValidator
  let TestRSKAddressValidator: TestRSKAddressValidator__factory
  // let chainId: number

  before(async () => {
      TestRSKAddressValidator = await ethers.getContractFactory('TestRSKAddressValidator') as TestRSKAddressValidator__factory
      addressValidator = await TestRSKAddressValidator.deploy()
      await addressValidator.deployed()
    // chainId = (await getTestingEnvironment()).chainId
  })
  it('should return true on check with data signed with zero', async function () {
    const messageHash = '0xf7cf90057f86838e5efd677f4741003ab90910e4e2736ff4d7999519d162d1ed'

    const v = 27
    const r = '3fba4230c7b08aa69affd0b7425b8666eb5e7d36f9ef84efeee5ba612c8df0bc'
    const s = '6b212d83adb8364e5519a051894f4a513b7eb68d087d710bf21e70775d31a97b'

    const signature = `0x${r}${s}${v.toString(16)}`

    addressValidator = await TestRSKAddressValidator.deploy()
    await addressValidator.deployed()
    const addr = await addressValidator.getAddress(messageHash, signature)
    expect(addr).to.be.equal('0xdcc703c0E500B653Ca82273B7BFAd8045D85a470')

    const res = await addressValidator.compareAddressWithZeroPK(messageHash, signature)
    expect(res).to.be.equal(false)
  })

  it('should return true on check with data signed with zero with message hash from tx', async function () {
    const messageHash = '0x4d3e45a3a5908513a10012e30a04fb2b438bab7da2acb93084e2f15a5eb55e8b'

    const v = 27
    const r = '90ef8cbc9ce5999887d32f3f5adf5292ada96b9506b51980f219d60271cf300c'
    const s = '3e59fb0088da48b32cb4d83f17af47dd7340cd0dab15ac214b7039b65ee8876d'

    const signature = `0x${r}${s}${v.toString(16)}`

    addressValidator = await TestRSKAddressValidator.deploy()
    await addressValidator.deployed()
    const addr = await addressValidator.getAddress(messageHash, signature)
    expect(addr).to.be.equal('0xdcc703c0E500B653Ca82273B7BFAd8045D85a470')

    const res = await addressValidator.compareAddressWithZeroPK(messageHash, signature)
    expect(res).to.be.equal(false)
  })

  it('should return FALSE on check with small case address and TRUE on check with checksummed address', async function () {
    const messageHash = '0x4d3e45a3a5908513a10012e30a04fb2b438bab7da2acb93084e2f15a5eb55e8b'
    const v = 27
    const r = '90ef8cbc9ce5999887d32f3f5adf5292ada96b9506b51980f219d60271cf300c'
    const s = '3e59fb0088da48b32cb4d83f17af47dd7340cd0dab15ac214b7039b65ee8876d'

    const signature = `0x${r}${s}${v.toString(16)}`

    addressValidator = await TestRSKAddressValidator.deploy()
    await addressValidator.deployed()
    const addr = await addressValidator.getAddress(messageHash, signature)
    expect(addr).to.be.not.equal('0xdcc703c0e500b653ca82273b7bfad8045d85a470')
    console.log('WARN: In testnet or mainnet with EIP1191, the chainID must be added to toChecksumAddress in order to pass')
    expect(addr).to.be.equal(ethers.utils.getAddress('0xdcc703c0e500b653ca82273b7bfad8045d85a470'))
  })

  it('should return true on check with small case address on solidity', async function () {
    const messageHash = '0x4d3e45a3a5908513a10012e30a04fb2b438bab7da2acb93084e2f15a5eb55e8b'

    const v = 27
    const r = '90ef8cbc9ce5999887d32f3f5adf5292ada96b9506b51980f219d60271cf300c'
    const s = '3e59fb0088da48b32cb4d83f17af47dd7340cd0dab15ac214b7039b65ee8876d'

    const signature = `0x${r}${s}${v.toString(16)}`

    const addr = '0xdcc703c0e500b653ca82273b7bfad8045d85a470'

    addressValidator = await TestRSKAddressValidator.deploy()
    await addressValidator.deployed()
    const areEqualSmallCase = await addressValidator.compareAddressWithSigner(messageHash, signature, addr)
    expect(areEqualSmallCase).to.be.true

    const addrChecksummed = ethers.utils.getAddress(addr)

    const areEqualChecksummed = await addressValidator.compareAddressWithSigner(messageHash, signature, addrChecksummed)
    expect(areEqualChecksummed).to.be.true
  })
})
