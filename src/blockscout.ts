import axios, { AxiosInstance } from 'axios'
import {
  IAssetData,
  IBlockScoutTx,
  IBlockScoutTokenTx,
  IParsedTx,
  ITxOperation
} from './types'
import { multiply, isNumber, convertStringToNumber } from './bignumber'
import { getChainData } from './utilities'
import { lookupMethod } from './method-registry'

const api: AxiosInstance = axios.create({
  baseURL: 'https://blockscout.com/',
  timeout: 30000, // 30 secs
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
})

export async function apiGetAccountBalance (address: string, chainId: number) {
  const chainData = getChainData(chainId)
  const chain = chainData.chain.toLowerCase()
  const network = chainData.network.toLowerCase()
  const module = 'account'
  const action = 'balance'
  const url = `/${chain}/${network}/api?module=${module}&action=${action}&address=${address}`
  const result = await api.get(url)
  return result
}

export async function apiGetAccountTokenList (address: string, chainId: number) {
  const chainData = getChainData(chainId)
  const chain = chainData.chain.toLowerCase()
  const network = chainData.network.toLowerCase()
  const module = 'account'
  const action = 'tokenlist'
  const url = `/${chain}/${network}/api?module=${module}&action=${action}&address=${address}`
  const result = await api.get(url)
  return result
}

export async function apiGetAccountTokenBalance (
  address: string,
  chainId: number,
  contractAddress: string
) {
  const chainData = getChainData(chainId)
  const chain = chainData.chain.toLowerCase()
  const network = chainData.network.toLowerCase()
  const module = 'account'
  const action = 'tokenbalance'
  const url = `/${chain}/${network}/api?module=${module}&action=${action}&contractaddress=${contractAddress}&address=${address}`
  const result = await api.get(url)
  return result
}

export async function apiGetAccountAssets (
  address: string,
  chainId: number
): Promise<IAssetData[]> {
  const chainData = getChainData(chainId)

  const nativeCurrency: IAssetData =
    chainData.chain.toLowerCase() !== 'dai'
      ? {
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: '18',
        contractAddress: '',
        balance: ''
      }
      : {
        symbol: 'DAI',
        name: 'Dai Stablecoin v1.0',
        decimals: '18',
        contractAddress: '0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359',
        balance: ''
      }
  const balanceRes = await apiGetAccountBalance(address, chainId)
  nativeCurrency.balance = balanceRes.data.result

  const tokenListRes = await apiGetAccountTokenList(address, chainId)
  const tokenList: IAssetData[] = tokenListRes.data.result

  let tokens: IAssetData[] = await Promise.all(
    tokenList.map(
      async (token: IAssetData): Promise<IAssetData> => {
        const tokenBalanceRes = await apiGetAccountTokenBalance(
          address,
          chainId,
          token.contractAddress
        )

        const tokenBalance = tokenBalanceRes.data.result

        if (
          tokenBalance &&
          isNumber(tokenBalance) &&
          convertStringToNumber(tokenBalance)
        ) {
          token.balance = tokenBalance
        }

        return token
      }
    )
  )
  tokens = tokens.filter(
    token =>
      !!Number(token.balance) &&
      !!token.balance &&
      !!token.decimals &&
      !!token.name
  )

  const assets: IAssetData[] = [nativeCurrency, ...tokens]

  return assets
}

export async function apiGetAccountTxList (address: string, chainId: number) {
  const chainData = getChainData(chainId)
  const chain = chainData.chain.toLowerCase()
  const network = chainData.network.toLowerCase()
  const module = 'account'
  const action = 'txlist'
  const url = `/${chain}/${network}/api?module=${module}&action=${action}&address=${address}`
  const result = await api.get(url)
  return result
}

export async function apiGetAccountTokenTx (address: string, chainId: number) {
  const chainData = getChainData(chainId)
  const chain = chainData.chain.toLowerCase()
  const network = chainData.network.toLowerCase()
  const module = 'account'
  const action = 'tokentx'
  const url = `/${chain}/${network}/api?module=${module}&action=${action}&address=${address}`
  const result = await api.get(url)
  return result
}

export async function apiGetAccountTransactions (
  address: string,
  chainId: number
): Promise<IParsedTx[]> {
  const txListRes = await apiGetAccountTxList(address, chainId)
  const txList: IBlockScoutTx[] = txListRes.data.result

  let transactions: IParsedTx[] = txList.map(
    (tx: IBlockScoutTx): IParsedTx => {
      const asset: IAssetData = {
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: '18',
        contractAddress: ''
      }

      const parsedTx: IParsedTx = {
        timestamp: multiply(tx.timeStamp, 1000),
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        nonce: tx.nonce,
        gasPrice: tx.gasPrice,
        gasUsed: tx.gasUsed,
        fee: multiply(tx.gasPrice, tx.gasUsed),
        value: tx.value,
        input: tx.input,
        error: tx.isError === '1',
        asset,
        operations: []
      }
      return parsedTx
    }
  )

  const tokenTxnsRes = await apiGetAccountTokenTx(address, chainId)
  const tokenTxns: IBlockScoutTokenTx[] = tokenTxnsRes.data.result

  await Promise.all(
    tokenTxns.map(async (tokenTx: IBlockScoutTokenTx) => {
      const asset: IAssetData = {
        symbol: tokenTx.tokenSymbol,
        name: tokenTx.tokenName,
        decimals: tokenTx.tokenDecimal,
        contractAddress: tokenTx.contractAddress
      }

      const functionHash = tokenTx.input.substring(0, 10)
      const functionMethod = await lookupMethod(functionHash)

      const functionName =
        functionMethod && functionMethod.name
          ? functionMethod.name
          : functionHash

      const operation: ITxOperation = {
        asset,
        value: tokenTx.value,
        from: tokenTx.from,
        to: tokenTx.to,
        functionName
      }

      let matchingTx = false

      for (const tx of transactions) {
        if (tokenTx.hash.toLowerCase() === tx.hash.toLowerCase()) {
          tx.operations.push(operation)
          matchingTx = true
          break
        }
      }

      // for (let i = 0; i < transactions.length; i++) {
      //   if (tokenTx.hash.toLowerCase() === transactions[i].hash.toLowerCase()) {
      //     transactions[i].operations.push(operation)
      //     matchingTx = true
      //     break
      //   }
      // }

      if (!matchingTx) {
        const asset: IAssetData = {
          symbol: 'ETH',
          name: 'Ethereum',
          decimals: '18',
          contractAddress: ''
        }

        const parsedTx: IParsedTx = {
          timestamp: multiply(tokenTx.timeStamp, 100),
          hash: tokenTx.hash,
          from: tokenTx.from,
          to: tokenTx.to,
          nonce: tokenTx.nonce,
          gasPrice: tokenTx.gasPrice,
          gasUsed: tokenTx.gasUsed,
          fee: multiply(tokenTx.gasPrice, tokenTx.gasUsed),
          value: tokenTx.value,
          input: tokenTx.input,
          error: false,
          asset,
          operations: []
        }

        transactions.push(parsedTx)
      }
    })
  )

  transactions.sort(
    (a, b) => parseInt(b.timestamp, 10) - parseInt(a.timestamp, 10)
  )

  return transactions
}
