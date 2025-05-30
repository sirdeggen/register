import { Request, Response } from 'express'
import { Certificate, createNonce, MasterCertificate, Utils, verifyNonce, WalletInterface } from '@bsv/sdk'


export interface CertifierServerOptions {
  port: number
  wallet: WalletInterface
  monetize: boolean
  calculateRequestPrice?: (req: Request) => number | Promise<number>
}

export interface CertifierRoute {
  type: 'post' | 'get'
  path: string
  summary: string
  parameters?: object
  exampleBody?: object
  exampleResponse: object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  func: (req: Request, res: Response, server: any) => Promise<any>
}

/**
 * Helper function which checks the arguments for the certificate signing request
 * @param {object} args
 * @throws {Error} if any of the required arguments are missing
 */
function certifierSignCheckArgs(args: { clientNonce: string, type: string, fields: Record<string, string>, masterKeyring: Record<string, string> }): void {
  if (!args.clientNonce) {
    throw new Error('Missing client nonce!')
  }
  if (!args.type) {
    throw new Error('Missing certificate type!')
  }
  if (!args.fields) {
    throw new Error('Missing certificate fields to sign!')
  }
  if (!args.masterKeyring) {
    throw new Error('Missing masterKeyring to decrypt fields!')
  }
}

/*
 * This route handles signCertificate for the acquireCertificate protocol.
 *
 * It validates the certificate signing request (CSR) received from the client,
 * decrypts and validates the field values,
 * and signs the certificate and its encrypted field values.
 *
 * The validated and signed certificate is returned to the client where the client saves their copy.
 */
export const signCertificate: CertifierRoute = {
  type: 'post',
  path: '/signCertificate',
  summary: 'Validate and sign a new certificate.',
  exampleBody: {
    type: 'jVNgF8+rifnz00856b4TkThCAvfiUE4p+t/aHYl1u0c=',
    clientNonce: 'VhQ3UUGl4L76T9v3M2YLd/Es25CEwAAoGTowblLtM3s=',
    fields: {
      cool: 'encrypted_value_here'
    },
    keyring: {
      cool: 'Eb8Nc9euJNuXNDRH4/50EQBbSRWWEJ5AvJKB/BFHNWcGIljSt1jE2RMQJmJPXi/OkaQuJuT0CGduPDlh3WbBtBztWXPzxcgdIifNpkV9Cp4='
    }
  },
  exampleResponse: {
    certificate: {
      type: 'jVNgF8+rifnz00856b4TkThCAvfiUE4p+t/aHYl1u0c=',
      subject: '02a1c81d78f5c404fd34c418525ba4a3b52be35328c30e67234bfcf30eb8a064d8',
      serialNumber: 'C9JwOFjAqOVgLi+lK7HpHlxHyYtNNN/Fgp9SJmfikh0=',
      fields: {
        cool: 'true'
      },
      revocationOutpoint: '000000000000000000000000000000000000000000000000000000000000000000000000',
      certifier: '025384871bedffb233fdb0b4899285d73d0f0a2b9ad18062a062c01c8bdb2f720a',
      signature: '3045022100a613d9a094fac52779b29c40ba6c82e8deb047e45bda90f9b15e976286d2e3a7022017f4dead5f9241f31f47e7c4bfac6f052067a98021281394a5bc859c5fb251cc'
    },
    serverNonce: 'UFX3UUGl4L76T9v3M2YLd/Es25CEwAAoGTowblLtM3s='
  },
  func: async (req, res, server) => {
    try {
      const { clientNonce, type, fields, masterKeyring } = req.body
      console.log({ clientNonce })
      // Validate params
      try {
        certifierSignCheckArgs(req.body)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid parameters'
        return res.status(400).json({
          status: 'error',
          description: message
        })
      }

      // Verify the client actually created the provided nonce
      await verifyNonce(clientNonce, req.wallet, (req as any).auth.identityKey)

      // Server creates a random nonce that the client can verify
      const serverNonce = await createNonce(req.wallet, (req as any).auth.identityKey)
      // The server computes a serial number from the client and server nonces
      const { hmac } = await req.wallet.createHmac({
        data: Utils.toArray(clientNonce + serverNonce, 'base64'),
        protocolID: [2, 'certificate issuance'],
        keyID: serverNonce + clientNonce,
        counterparty: (req as any).auth.identityKey
      })
      const serialNumber = Utils.toBase64(hmac)

      // Decrypt certificate fields and verify them before signing
      const decryptedFields = await MasterCertificate.decryptFields(
        req.wallet,
        masterKeyring,
        fields,
        (req as any).auth.identityKey
      )

      console.log({ decryptedFields })

      // Create a revocation outpoint (logic omitted for simplicity)
      const revocationTxid = '0000000000000000000000000000000000000000000000000000000000000000'

      const signedCertificate = new Certificate(
        type,
        serialNumber,
        (req as any).auth.identityKey,
        ((await req.wallet.getPublicKey({ identityKey: true })).publicKey),
        `${revocationTxid}.0`,
        fields
      )

      await signedCertificate.sign(req.wallet)
      
      // Returns signed cert to the requester
      return res.status(200).json({
        certificate: signedCertificate,
        serverNonce
      })
    } catch (e) {
      console.error(e)
      return res.status(500).json({
        status: 'error',
        code: 'ERR_INTERNAL',
        description: 'An internal error has occurred.'
      })
    }
  }
}