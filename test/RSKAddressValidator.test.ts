import {
    TestRSKAddressValidatorInstance
  } from '../types/truffle-contracts'

const TestRSKAddressValidator = artifacts.require('TestRSKAddressValidator')
  
contract('RSKAddressValidator', function (accounts) {
    let addressValidator: TestRSKAddressValidatorInstance
    it("should return true on check with data signed with zero", async function () {
      let messageHash = "0xf7cf90057f86838e5efd677f4741003ab90910e4e2736ff4d7999519d162d1ed"

      let v = 27
      let r = "3fba4230c7b08aa69affd0b7425b8666eb5e7d36f9ef84efeee5ba612c8df0bc"
      let s = "6b212d83adb8364e5519a051894f4a513b7eb68d087d710bf21e70775d31a97b"

      let signature = `0x${r}${s}${v.toString(16)}`

      addressValidator = await TestRSKAddressValidator.new()
      const addr = await addressValidator.getSig.call(messageHash, signature)
      expect(addr).to.be.equal("0xdcc703c0E500B653Ca82273B7BFAd8045D85a470")

      const res = await addressValidator.compareAddressWithZeroPK.call(messageHash, signature)
      expect(res).to.be.equal(false)
    })
  })