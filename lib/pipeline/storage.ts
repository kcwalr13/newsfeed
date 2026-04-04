import fs from 'fs';
import path from 'path';
import { BATCH_DIR, LOG_PATH } from './config';
import type { ArticleBatch } from '../types/article';

/**
 * Writes a batch to data/batches/<batchDate>.json.
 * Creates the batches directory if it does not exist.
 * Does NOT overwrite an existing file — returns false if the file already existed.
 * Returns true if the file was written successfully.
 */
export function writeBatch(batch: ArticleBatch): boolean {
  if (!fs.existsSync(BATCH_DIR)) {
    fs.mkdirSync(BATCH_DIR, { recursive: true });
  }
  const filePath = path.join(BATCH_DIR, `${batch.batchDate}.json`);
  if (fs.existsSync(filePath)) {
    return false;
  }
  fs.writeFileSync(filePath, JSON.stringify(batch, null, 2), 'utf-8');
  return true;
}

/**
 * Reads and parses data/batches/<date>.json.
 * Returns null if the file does not exist.
 */
export function readBatch(date: string): ArticleBatch | null {
  const filePath = path.join(BATCH_DIR, `${date}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ArticleBatch;
}

/**
 * Reads the most recent batch file from data/batches/ by sorting filenames descending.
 * Returns null if the directory is empty or missing.
 */
export function readLatestBatch(): ArticleBatch | null {
  if (!fs.existsSync(BATCH_DIR)) {
    return null;
  }
  const files = fs
    .readdirSync(BATCH_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) {
    return null;
  }
  const raw = fs.readFileSync(path.join(BATCH_DIR, files[0]), 'utf-8');
  return JSON.parse(raw) as ArticleBatch;
}

/**
 * Appends a timestamped line to data/pipeline.log.
 * Creates the file if it does not exist.
 */
export function appendLog(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(LOG_PATH, line, 'utf-8');
}
