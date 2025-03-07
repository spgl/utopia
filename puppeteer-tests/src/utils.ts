/* eslint-disable no-console */
import * as puppeteer from 'puppeteer'
import type { PageEventObject } from 'puppeteer'
const fs = require('fs')
const path = require('path')
const AWS = require('aws-sdk')
const yn = require('yn')

export const setupBrowser = async (
  url: string,
  defaultTimeout: number,
): Promise<{
  page: puppeteer.Page
  browser: puppeteer.Browser
}> => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--enable-thread-instruction-count'],
    headless: yn(process.env.HEADLESS),
    executablePath: process.env.BROWSER,
  })
  const page = await browser.newPage()
  page.setDefaultNavigationTimeout(120000)
  page.setDefaultTimeout(defaultTimeout)
  await page.setViewport({ width: 1500, height: 768 })
  console.info('loading editor at URL:', url)
  await page.goto(url)
  return {
    browser: browser,
    page: page,
  }
}

interface ValueWithTimeout {
  timeoutID: NodeJS.Timeout | null
}

export const ONE_SECOND_IN_MS = 1000
export const ONE_MINUTE_IN_MS = 60 * ONE_SECOND_IN_MS

export function timeLimitPromise<T>(
  promise: Promise<T>,
  limitms: number,
  message: string,
): Promise<T> {
  let valueWithTimeout: ValueWithTimeout = { timeoutID: null }
  const timeoutPromise: Promise<any> = new Promise((resolve, reject) => {
    valueWithTimeout.timeoutID = setTimeout(() => {
      if (valueWithTimeout.timeoutID != null) {
        clearTimeout(valueWithTimeout.timeoutID)
      }
      reject(message)
    }, limitms)
  })
  const promiseWithCleanup = promise.finally(() => {
    if (valueWithTimeout.timeoutID != null) {
      clearTimeout(valueWithTimeout.timeoutID)
    }
  })
  return Promise.race([promiseWithCleanup, timeoutPromise])
}

export function consoleDoneMessage(
  page: puppeteer.Page,
  expectedConsoleMessage: string,
  errorMessage?: string,
): Promise<void> {
  let handler: (message: PageEventObject['console']) => void = () => {
    console.info('Should not fire.')
  }
  const consoleDonePromise = new Promise<void>((resolve, reject) => {
    handler = (message: PageEventObject['console']) => {
      const messageText = message.text()
      if (
        messageText.includes(expectedConsoleMessage) ||
        (errorMessage != null && messageText.includes(errorMessage))
      ) {
        // the editor will console.info('SCROLL_TEST_FINISHED') when the scrolling test is complete.
        // we wait until we see this console log and then we resolve the Promise
        resolve()
      } else {
        console.info(`CONSOLE: ${messageText}`)
      }
    }
    page.on('console', handler)
  })
  return timeLimitPromise(
    consoleDonePromise,
    10 * ONE_MINUTE_IN_MS, // 10 minutes.
    `Missing console message ${expectedConsoleMessage} in test browser.`,
  ).finally(() => {
    // Ensure we remove the handler afterwards.
    page.off('console', handler)
  })
}

export async function uploadPNGtoAWS(testFile: string): Promise<string | null> {
  if (
    process.env.AWS_REGION == null ||
    process.env.AWS_ACCESS_KEY_ID == null ||
    process.env.AWS_SECRET_ACCESS_KEY == null
  ) {
    console.info('AWS upload skipped because of missing region or access keys')
    return null
  }

  AWS.config.update({
    region: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  })

  let s3 = new AWS.S3({ apiVersion: '2006-03-01' })
  const uploadParams = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: testFile,
    Body: '',
    ContentType: 'image/png',
    ACL: 'public-read',
  }

  return new Promise<string>((resolve, reject) => {
    const path1 = path.resolve(testFile)
    let filestream = fs.createReadStream(path1)
    filestream.on('error', function (err: any) {
      console.log('File Error', err)
      reject(err)
    })
    uploadParams.Body = filestream
    uploadParams.Key = path.basename(testFile)

    s3.upload(uploadParams, function (err: any, data: any) {
      if (err) {
        console.log('Error', err)
        reject(err)
      }
      if (data) {
        console.log('Upload Success', data.Location)
        resolve(data.Location)
      }
    })
  })
}

export async function initialiseTests(page: puppeteer.Page): Promise<void> {
  console.log('Initialising the project')
  await page.waitForXPath('//div[contains(@class, "item-label-container")]')

  // Select something
  const navigatorElement = await page.$('[class^="item-label-container"]')
  await navigatorElement!.click()

  // First selection will open the file in VS Code, triggering a bunch of downloads, so we pause briefly
  await page.waitForTimeout(15000)

  console.log('Finished initialising')
}
