/* eslint-disable @typescript-eslint/no-extraneous-class */
import * as actions_http_client from '@actions/http-client'
import { RequestOptions } from '@actions/http-client/lib/interfaces'
import { HttpClient, HttpClientResponse } from '@actions/http-client'
import { BearerCredentialHandler } from '@actions/http-client/lib/auth'

import ifm from '@actions/http-client/lib/interfaces'
interface TokenResponse {
  value?: string
}

export class HttpClientError extends Error {
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'HttpClientError'
    this.statusCode = statusCode
    Object.setPrototypeOf(this, HttpClientError.prototype)
  }

  statusCode: number
  result?: any
}

export class OidcClient {
  private static createHttpClient(
    allowRetry = true,
    maxRetry = 10
  ): actions_http_client.HttpClient {
    const requestOptions: RequestOptions = {
      allowRetries: allowRetry,
      maxRetries: maxRetry
    }

    return new HttpClient(
      'actions/oidc-client',
      [new BearerCredentialHandler(OidcClient.getRequestToken())],
      requestOptions
    )
  }

  private static getRequestToken(): string {
    const token = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
    if (!token) {
      throw new Error(
        'Unable to get ACTIONS_ID_TOKEN_REQUEST_TOKEN env variable'
      )
    }
    return token
  }

  private static getIDTokenUrl(): string {
    const runtimeUrl = process.env['ACTIONS_ID_TOKEN_REQUEST_URL']
    if (!runtimeUrl) {
      throw new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable')
    }
    return runtimeUrl
  }

  private static async getCall(id_token_url: string, subjectClaims?: string[]): Promise<string> {
    const httpclient = OidcClient.createHttpClient()

    // const res = await httpclient
    //   .getJson<TokenResponse>(id_token_url)
    //   .catch(error => {
    //     throw new Error(
    //       `Failed to get ID Token. \n 
    //     Error Code : ${error.statusCode}\n 
    //     Error Message: ${error.message}`
    //     )
    //   })

    /////

    const additionalHeaders: Record<string, string> = {
      "accept": 'application/json'
    }
    const data = JSON.stringify({
      "include_claim_keys": subjectClaims
    })
   
    const resRaw: HttpClientResponse = await httpclient.request('GET', id_token_url, data, additionalHeaders || {})
    let res = await this._processResponse<TokenResponse>(resRaw, undefined)

    const id_token = res.result?.value
    if (!id_token) {
      throw new Error('Response json body do not have ID Token field')
    }
    return id_token
  }

  static async getIDToken(audience?: string, subjectClaims?: string[]): Promise<string> {
    try {
      // New ID Token is requested from action service
      let id_token_url: string = OidcClient.getIDTokenUrl()
      if (audience) {
        const encodedAudience = encodeURIComponent(audience)
        id_token_url = `${id_token_url}&audience=${encodedAudience}`
      }

      //   debug(`ID token url is ${id_token_url}`)

      const id_token = await OidcClient.getCall(id_token_url, subjectClaims)
      //   setSecret(id_token)
      return id_token
    } catch (error: any) {
      throw new Error(`Error message: ${error.message}`)
    }
  }

  private static async _processResponse<T>(
    res: HttpClientResponse,
    options?: ifm.RequestOptions
  ): Promise<ifm.TypedResponse<T>> {
    return new Promise<ifm.TypedResponse<T>>(async (resolve, reject) => {
      const statusCode = res.message.statusCode || 0

      const response: ifm.TypedResponse<T> = {
        statusCode,
        result: null,
        headers: {}
      }

      // not found leads to null obj returned
      if (statusCode === 404) {
        resolve(response)
      }

      // get the result from the body

      function dateTimeDeserializer(_key: any, value: any): any {
        if (typeof value === 'string') {
          const a = new Date(value)
          if (!isNaN(a.valueOf())) {
            return a
          }
        }

        return value
      }

      let obj: any
      let contents: string | undefined

      try {
        contents = await res.readBody()
        if (contents && contents.length > 0) {
          if (options && options.deserializeDates) {
            obj = JSON.parse(contents, dateTimeDeserializer)
          } else {
            obj = JSON.parse(contents)
          }

          response.result = obj
        }

        response.headers = res.message.headers
      } catch (err) {
        // Invalid resource (contents not json);  leaving result obj null
      }

      // note that 3xx redirects are handled by the http layer.
      if (statusCode > 299) {
        let msg: string

        // if exception/error in body, attempt to get better error
        if (obj && obj.message) {
          msg = obj.message
        } else if (contents && contents.length > 0) {
          // it may be the case that the exception is in the body message as string
          msg = contents
        } else {
          msg = `Failed request: (${statusCode})`
        }

        const err = new HttpClientError(msg, statusCode)
        err.result = response.result

        reject(err)
      } else {
        resolve(response)
      }
    })
  }
}
