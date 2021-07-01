import express, { Express, Request, Response } from 'express'
import jsonrpc from 'jsonrpc-lite'
import bodyParser from 'body-parser'
import cors from 'cors'
import { RelayServer } from './RelayServer'
import { Server } from 'http'
import log from 'loglevel'
import { Address } from '../relayclient/types/Aliases'
import { PrefixedHexString } from 'ethereumjs-tx'

export class HttpServer {
  app: Express
  private serverInstance?: Server

  constructor (private readonly port: number, readonly backend: RelayServer) {
    this.app = express()
    this.app.use(cors())

    this.app.use(bodyParser.urlencoded({ extended: false }))
    this.app.use(bodyParser.json())
    /* eslint-disable @typescript-eslint/no-misused-promises */
    this.app.post('/', this.rootHandler.bind(this))
    this.app.get('/getaddr', this.pingHandler.bind(this))
    this.app.get('/status', this.statusHandler.bind(this))
    this.app.get('/tokens', this.tokenHandler.bind(this))
    this.app.get('/verifiers', this.verifierHandler.bind(this))
    this.app.get('/feestable', this.feeEstimatorHandler.bind(this))
    this.app.post('/relay', this.relayHandler.bind(this))
    this.backend.once('removed', this.stop.bind(this))
    this.backend.once('unstaked', this.close.bind(this))
    /* eslint-enable */
    this.backend.on('error', (e) => { console.error('httpServer:', e) })
  }

  start (): void {
    if (this.serverInstance === undefined) {
      this.serverInstance = this.app.listen(this.port, () => {
        console.log('Listening on port', this.port)
        this.startBackend()
          .then(() => console.log('Started Backend Successfully'))
          .catch(error => console.error('Error starting backend', error))
      })
    }
  }

  async startBackend (): Promise<void> {
    try {
      await this.backend.start()
    } catch (e) {
      log.error('relay task error', e)
    }
  }

  stop (): void {
    this.serverInstance?.close()
    console.log('Http server stopped.\nShutting down relay...')
  }

  close (): void {
    console.log('Stopping relay worker...')
    this.backend.stop()
  }

  // TODO: use this when changing to jsonrpc
  async rootHandler (req: any, res: any): Promise<void> {
    let status
    try {
      let res
      // @ts-ignore
      const func = this.backend[req.body.method]
      if (func != null) {
        res = await func.apply(this.backend, [req.body.params]) ?? { code: 200 }
      } else {
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw Error(`Implementation of method ${req.body.params} not found on backend!`)
      }
      status = jsonrpc.success(req.body.id, res)
    } catch (e) {
      let stack = e.stack.toString()
      // remove anything after 'rootHandler'
      stack = stack.replace(/(rootHandler.*)[\s\S]*/, '$1')
      status = jsonrpc.error(req.body.id, new jsonrpc.JsonRpcError(stack, -125))
    }
    res.send(status)
  }

  async pingHandler (req: Request, res: Response): Promise<void> {
    try {
      const pingResponse = await this.backend.pingHandler(req.query.verifier as string, req.query.maxTime as string)
      res.send(pingResponse)
      console.log(`address ${pingResponse.relayWorkerAddress} sent. ready: ${pingResponse.ready}`)
    } catch (e) {
      const message: string = e.message
      res.send({ message })
      log.error(`ping handler rejected: ${message}`)
    }
  }

  statusHandler (req: any, res: any): void {
    // TODO: check components and return proper status code
    res.status(204).end()
  }

  async relayHandler (req: Request, res: Response): Promise<void> {
    try {
      const { signedTx, signedReceipt, transactionHash } = await this.backend.createRelayTransaction(req.body)
      res.send({ signedTx, signedReceipt, transactionHash })
    } catch (e) {
      res.send({ error: e.message })
      console.log('tx failed:', e)
    }
  }

  async tokenHandler (req: Request, res: Response): Promise<void> {
    try {
      const verifier = req.query.verifier as Address
      const tokenResponse = await this.backend.tokenHandler(verifier)
      res.send(tokenResponse)
    } catch (e) {
      const message: string = e.message
      res.send({ message })
      log.error(`token handler rejected: ${message}`)
    }
  }

  async verifierHandler (req: Request, res: Response): Promise<void> {
    try {
      const verifierResponse = await this.backend.verifierHandler()
      res.send(verifierResponse)
    } catch (e) {
      const message: string = e.message
      res.send({ message })
      log.error(`verified handler rejected: ${message}`)
    }
  }

  // temp
  async penalizerHandler (req: Request, res: Response): Promise<void> {
    try {
      const penalizerAddress = req.query.penalizer as Address
      const signature = req.query.signature as PrefixedHexString
      const penalizerResponse = await this.backend.penalizerHandler(penalizerAddress, signature)
      res.send(penalizerResponse)
    } catch (e) {
      const message: string = e.message
      res.send({ message })
      log.error(`penalizer handler rejected: ${message}`)
    }
  }

  async feeEstimatorHandler (req: any, res: any): Promise<void> {
    const feesTable = await this.backend.envelopingArbiter.getFeesTable()
    res.send(feesTable)
  }
}
