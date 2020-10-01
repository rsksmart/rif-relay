import {
    ForwarderInstance,
    TestTokenInstance,
    ProxyFactoryInstance
  } from '../types/truffle-contracts'
  // @ts-ignore
  import { bufferToHex, privateToAddress, toBuffer } from 'ethereumjs-util'
  import { expectRevert, expectEvent } from '@openzeppelin/test-helpers'
  import { toChecksumAddress } from 'web3-utils'
  import { ethers } from 'ethers'
  import chai from 'chai'

  
  
  const Forwarder = artifacts.require('Forwarder')
  const TestToken = artifacts.require('TestToken')
  const ProxyFactory = artifacts.require('ProxyFactory')
    
  function addr (n: number): string {
    return '0x' + n.toString().repeat(40)
  }
  
  function bytes32 (n: number): string {
    return '0x' + n.toString().repeat(64).slice(0, 64)
  }

  function stripHex(s: string): string {
      return s.slice(2, s.length);
  }



 contract('ProxyFactory', ([from]) => {
  
    let fwd: ForwarderInstance
    let token: TestTokenInstance
    let factory : ProxyFactoryInstance

  
    const ownerPrivateKey = toBuffer(bytes32(1))
    const ownerAddress = toChecksumAddress(bufferToHex(privateToAddress(ownerPrivateKey)))

    const recipientPrivateKey = toBuffer(bytes32(1))
    const recipientAddress = toChecksumAddress(bufferToHex(privateToAddress(recipientPrivateKey)))
    
    before(async () => {

      fwd = await Forwarder.new()
    })

    beforeEach(async()=>{
        //A new factory for new create2 addresses each
        factory = await ProxyFactory.new(fwd.address)
    })
    
    describe('#getCreationBytecode', ()=>{
        it('should return the expected bytecode', async () =>{

            const expectedCode = '0x602D3D8160093D39F3363D3D373D3D3D3D363D73'+
            stripHex(fwd.address) + '5AF43D923D90803E602B57FD5BF3';

            const code = await factory.getCreationBytecode();
            chai.expect(web3.utils.toBN(expectedCode)).to.be.bignumber.equal(web3.utils.toBN(code))

        })
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

        it('should create the Smart Wallet with the expected proxy code', async () =>{
            const logicAddress = addr(0)
            const initParams = "0x00"
            const logicInitGas = "0x00"
     
            const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, logicAddress, initParams)
            
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

            //expectedCode = runtime code only
            let expectedCode = await factory.getCreationBytecode();
            expectedCode = '0x'+ expectedCode.slice(20, expectedCode.length);
   
            const { logs } = await factory.createUserSmartWallet(ownerAddress,
                logicAddress, logicInitGas,
                initParams, signatureCollapsed)
             
            const code = await web3.eth.getCode(expectedAddress, logs[0].blockNumber)

            chai.expect(web3.utils.toBN(expectedCode)).to.be.bignumber.equal(web3.utils.toBN(code))

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

            //Check the emitted event
            expectEvent.inLogs(logs, 'Deployed', {
                addr: expectedAddress,
                salt:expectedSalt 
            })

            //The Smart Wallet should have been charged for the deploy
            const newBalance = await token.balanceOf(expectedAddress)
            const expectedBalance = originalBalance.sub(web3.utils.toBN(deployPrice))
            chai.expect(expectedBalance).to.be.bignumber.equal(newBalance)
        
        })

        it('should create the Smart Wallet with the expected proxy code', async () =>{
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

            //expectedCode = runtime code only
            let expectedCode = await factory.getCreationBytecode();
            expectedCode = '0x'+ expectedCode.slice(20, expectedCode.length);
   
            const { logs } = await factory.delegateUserSmartWalletCreation(ownerAddress,
                logicAddress, token.address, recipientAddress, deployPrice, logicInitGas,
                initParams, signatureCollapsed)
             
            const code = await web3.eth.getCode(expectedAddress, logs[0].blockNumber)

            chai.expect(web3.utils.toBN(expectedCode)).to.be.bignumber.equal(web3.utils.toBN(code))

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

        it('should not initialize if a second initialize() call to the Smart Wallet is attempted', async () =>{
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

            //Check the emitted event
            expectEvent.inLogs(logs, 'Deployed', {
                addr: expectedAddress,
                salt:expectedSalt 
            })

            //The Smart Wallet should have been charged for the deploy
            const newBalance = await token.balanceOf(expectedAddress)
            const expectedBalance = originalBalance.sub(web3.utils.toBN(deployPrice))
            chai.expect(expectedBalance).to.be.bignumber.equal(newBalance)


            const isInitializedFunc = web3.eth.abi.encodeFunctionCall({
                name: 'isInitialized',
                type: 'function',
                inputs: []
            },[]);

            const trx = await web3.eth.getTransaction(logs[0].transactionHash)

            let newTrx = {
                from: trx.from,
                gas: trx.gas,
                to: expectedAddress,
                gasPrice: trx.gasPrice,
                value: trx.value,
                data: isInitializedFunc
            }

            //Call the initialize function
            let result  = await web3.eth.call(newTrx)


            let resultStr = result as string

            //It should be initialized
            chai.expect(web3.utils.toBN(1)).to.be.bignumber.equal(web3.utils.toBN(resultStr))


            const transferFunc = await web3.eth.abi.encodeFunctionCall({
                name: 'transfer',
                type: 'function',
                inputs: [{
                    type: 'address',
                    name: '_to'
                },
                {
                    type: 'uint256',
                    name: '_value'
                }
            ]
            },[
                recipientAddress, deployPrice
            ])

          
           const initFunc = await web3.eth.abi.encodeFunctionCall({
                name: 'initialize',
                type: 'function',
                inputs: [{
                    type: 'address',
                    name: 'owner'
                },
                {
                    type: 'address',
                    name: 'logic'
                },
                {
                    type: 'address',
                    name: 'tokenAddr'
                },
                {
                    type: 'uint256',
                    name: 'logicInitGas'
                },
                {
                    type: 'bytes',
                    name: 'initParams'
                },
                {
                    type: 'bytes',
                    name: 'transferData'
                }
            ]
            }, [ownerAddress, logicAddress, token.address, logicInitGas, initParams, transferFunc]);


             newTrx.data = initFunc
            

 

            //Trying to manually call the initialize function again (it was called during deploy)
            result  = await web3.eth.call(newTrx)
            resultStr = result as string

            //It should return false since it was already initialized
            chai.expect(web3.utils.toBN(0)).to.be.bignumber.equal(web3.utils.toBN(resultStr))

            newTrx.data = isInitializedFunc

            result  = await web3.eth.call(newTrx)
            resultStr = result as string

            //The smart wallet should be still initialized
            chai.expect(web3.utils.toBN(1)).to.be.bignumber.equal(web3.utils.toBN(resultStr))

        })

        it('getting the smart wallet address should not create the contract', async () =>{
            const logicAddress = addr(0)
            const initParams = "0x00"
     
            const expectedAddress = await factory.getSmartWalletAddress(ownerAddress, logicAddress, initParams)

            //Call the initialize function
            let contractCode  = await web3.eth.getCode(expectedAddress, 'latest');
            console.log(contractCode);
            chai.expect(web3.utils.toBN(0)).to.be.bignumber.equal(web3.utils.toBN(contractCode))
        })
        
    })
 })
