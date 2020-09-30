import {
    ForwarderInstance,
    TestForwarderInstance,
    TestForwarderTargetInstance,
    TestTokenInstance,
    ProxyFactoryInstance
  } from '../types/truffle-contracts'
  // @ts-ignore
  import { EIP712TypedData, signTypedData_v4, TypedDataUtils, signTypedData } from 'eth-sig-util'
  import { bufferToHex, privateToAddress, toBuffer, BN } from 'ethereumjs-util'
  import { ether, expectRevert, expectEvent } from '@openzeppelin/test-helpers'
  import { toChecksumAddress } from 'web3-utils'
  import { encode } from 'punycode'
  import { ethers } from 'ethers'
  import chai from 'chai'

  
  const TestForwarderTarget = artifacts.require('TestForwarderTarget')
  
  const Forwarder = artifacts.require('Forwarder')
  const TestToken = artifacts.require('TestToken')
  const TestForwarder = artifacts.require('TestForwarder')
  const ProxyFactory = artifacts.require('ProxyFactory')
  
  const keccak256 = web3.utils.keccak256
  
  function addr (n: number): string {
    return '0x' + n.toString().repeat(40)
  }
  
  function bytes32 (n: number): string {
    return '0x' + n.toString().repeat(64).slice(0, 64)
  }

  function stripHex(value: string):string{
      return value.slice(2, value.length);
  }

  
  // Global EIP712 type definitions.
  // (read from helper package?)
  const EIP712DomainType = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' }
  ]
  
  const TokenPaymentType = [
    { name: 'tokenRecipient', type: 'address' },
    { name: 'tokenContract', type: 'address' },
    { name: 'paybackTokens', type: 'uint256' },
    { name: 'tokenGas', type: 'uint256' }
  ]
  
  const ForwardRequestType = [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    ...TokenPaymentType
  ]
  
 contract('ProxyFactory', ([from]) => {
    const GENERIC_PARAMS = 'address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data,address tokenRecipient,address tokenContract,uint256 paybackTokens,uint256 tokenGas'
    // our generic params has 6 bytes32 values
    const countParams = ForwardRequestType.length
  
    let fwd: ForwarderInstance
    let token: TestTokenInstance
    let factory : ProxyFactoryInstance

    const senderPrivateKey = toBuffer(bytes32(1))
    const senderAddress = toChecksumAddress(bufferToHex(privateToAddress(senderPrivateKey)))
  
    const ownerPrivateKey = toBuffer(bytes32(1))
    const ownerAddress = toChecksumAddress(bufferToHex(privateToAddress(ownerPrivateKey)))

    const recipientPrivateKey = toBuffer(bytes32(1))
    const recipientAddress = toChecksumAddress(bufferToHex(privateToAddress(recipientPrivateKey)))
    
    before(async () => {

      fwd = await Forwarder.new()
      factory = await ProxyFactory.new(fwd.address)

      assert.equal(await fwd.GENERIC_PARAMS(), GENERIC_PARAMS)
    })
  
    describe('#getSmartWalletAddress', ()=>{
  
        it('should create the correct create2 Address', async () =>{
            const logicAddress = addr(0)
            const initParams = "0x00"
            const create2Address = await factory.getSmartWalletAddress(ownerAddress, logicAddress, initParams)
            
            const creationByteCode = await factory.getCreationBytecode()

            const salt:string = ""+web3.utils.soliditySha3(
                {t:"address",v:ownerAddress}, 
                {t:"address", v:logicAddress},
                {t:"bytes", v:initParams}
            )

            const bytecodeHash:string = ""+web3.utils.soliditySha3(
                {t:"bytes", v:creationByteCode}
            )

            const _data:string = ""+web3.utils.soliditySha3(
                {t:"bytes1", v:'0xff'},
                {t:"address", v:factory.address},
                {t:"bytes32", v: salt},
                {t:"bytes32", v:bytecodeHash}
            )
            const expectedAddress = toChecksumAddress("0x"+_data.slice(26, _data.length))
            assert.equal(create2Address, expectedAddress)
        })
    })
    
    describe('#createUserSmartWallet', ()=>{
  
        it('should create the Smart Wallet in the expected address', async () =>{
            const logicAddress = addr(0)
            const initParams = "0x00"
            const logicInitGas = "0x00"
                        
            const toSign:string = "" + web3.utils.soliditySha3(
                {t:"bytes2",v:'0x1910'}, 
                {t:"address",v:ownerAddress}, 
                {t:"address",v:logicAddress}, 
                {t:"uint256",v:logicInitGas},
                {t:"bytes",v:initParams}
            )
                 
            const toSignAsBinaryArray = ethers.utils.arrayify(toSign);
            const signingKey = new ethers.utils.SigningKey(ownerPrivateKey);
            const signature = signingKey.signDigest(toSignAsBinaryArray);
            const signatureCollapsed = ethers.utils.joinSignature(signature);


            const { logs } = await factory.createUserSmartWallet(ownerAddress, logicAddress, logicInitGas,
                initParams, signatureCollapsed)

            const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, logicAddress, initParams)
            
            
            const salt = ""+web3.utils.soliditySha3(
                {t:"address",v:ownerAddress}, 
                {t:"address", v:logicAddress},
                {t:"bytes", v:initParams}
            )

            const expectedSalt = web3.utils.toBN(salt).toString();

            expectEvent.inLogs(logs, 'Deployed', {
                addr: expectedAddress,
                salt:expectedSalt 
            })
        })

        it('should revert for an invalid signature', async () =>{
            const logicAddress = addr(0)
            const initParams = "0x00"
            const logicInitGas = "0x00"
                        
            const toSign:string = "" + web3.utils.soliditySha3(
                {t:"bytes2",v:'0x1910'}, 
                {t:"address",v:ownerAddress}, 
                {t:"address",v:logicAddress}, 
                {t:"uint256",v:logicInitGas},
                {t:"bytes",v:initParams}
            )
                 
          
            const toSignAsBinaryArray = ethers.utils.arrayify(toSign);
            const signingKey = new ethers.utils.SigningKey(ownerPrivateKey);
            const signature = signingKey.signDigest(toSignAsBinaryArray);
            let signatureCollapsed:string = ethers.utils.joinSignature(signature);
            
            signatureCollapsed = signatureCollapsed.substr(0, signatureCollapsed.length-1).concat('0');

            await expectRevert.unspecified(factory.createUserSmartWallet(ownerAddress, logicAddress, logicInitGas,
                initParams, signatureCollapsed))
        })
    })

    describe('#delegateUserSmartWalletCreation', ()=>{

        beforeEach(async()=>{
            factory = await ProxyFactory.new(fwd.address)
        })

        it('should create the Smart Wallet in the expected address', async () =>{
            const logicAddress = addr(0)
            const initParams = "0x00"
            const logicInitGas = "0x00"
            const deployPrice = "0x01" // 1 token
     
            const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, logicAddress, initParams)
                 
            token = await TestToken.new()
            await token.mint('200',expectedAddress)

            const originalBalance = await token.balanceOf(expectedAddress)

            const toSign:string = "" + web3.utils.soliditySha3(
                {t:"bytes2",v:'0x1910'}, 
                {t:"address",v:ownerAddress}, 
                {t:"address",v:logicAddress}, 
                {t:"address",v:token.address}, 
                {t:"address",v:recipientAddress},
                {t:"uint256",v:deployPrice},
                {t:"uint256",v:logicInitGas},
                {t:"bytes",v:initParams}
            )

            const toSignAsBinaryArray = ethers.utils.arrayify(toSign);
            const signingKey = new ethers.utils.SigningKey(ownerPrivateKey);
            const signature = signingKey.signDigest(toSignAsBinaryArray);
            const signatureCollapsed = ethers.utils.joinSignature(signature);

            const { logs } = await factory.delegateUserSmartWalletCreation(ownerAddress,
                logicAddress, token.address, recipientAddress, deployPrice, logicInitGas,
                initParams, signatureCollapsed)
            
            
            const salt = ""+web3.utils.soliditySha3(
                {t:"address",v:ownerAddress}, 
                {t:"address", v:logicAddress},
                {t:"bytes", v:initParams}
            )

            const expectedSalt = web3.utils.toBN(salt).toString();

            expectEvent.inLogs(logs, 'Deployed', {
                addr: expectedAddress,
                salt:expectedSalt 
            })

            const newBalance = await token.balanceOf(expectedAddress)
            const expectedBalance = originalBalance.sub(new BN(1))

            chai.expect(expectedBalance).to.be.bignumber.equal(newBalance)
        
        })

        it('should revert for an invalid signature', async () =>{

            //TODO MODIFY TO USE DELEGATE
            
            const logicAddress = addr(0)
            const initParams = "0x00"
            const logicInitGas = "0x00"
            const deployPrice = "0x01" // 1 token

                 
            //Use incomplete digest
            const toSign:string = "" + web3.utils.soliditySha3(
                {t:"bytes2",v:'0x1910'}, 
                {t:"address",v:ownerAddress}, 
                {t:"address",v:logicAddress}, 
                {t:"uint256",v:logicInitGas},
                {t:"bytes",v:initParams}
            )
                 
            const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, logicAddress, initParams)
            await token.mint('200',expectedAddress)
            const originalBalance = await token.balanceOf(expectedAddress)

          
            const toSignAsBinaryArray = ethers.utils.arrayify(toSign);
            const signingKey = new ethers.utils.SigningKey(ownerPrivateKey);
            const signature = signingKey.signDigest(toSignAsBinaryArray);
            let signatureCollapsed:string = ethers.utils.joinSignature(signature);
            
            await expectRevert.unspecified(factory.delegateUserSmartWalletCreation(ownerAddress,
                logicAddress, token.address, recipientAddress, deployPrice, logicInitGas,
                initParams, signatureCollapsed))

                const newBalance = await token.balanceOf(expectedAddress)

                chai.expect(originalBalance).to.be.bignumber.equal(newBalance)

        })
    })
 })
