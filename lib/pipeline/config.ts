import path from 'path';
import fs from 'fs';
import type { Source } from '../types/article';

/** Number of articles to include in each daily batch. */
export const ARTICLES_PER_DAY: number = process.env.ARTICLES_PER_DAY
  ? parseInt(process.env.ARTICLES_PER_DAY, 10)
  : 20;

/** Absolute path to the directory where daily batch JSON files are stored. */
export const BATCH_DIR: string = path.resolve(process.cwd(), 'data', 'batches');

/** Absolute path to the sources configuration file. */
export const SOURCES_PATH: string = path.resolve(process.cwd(), 'data', 'sources.json');

/** Absolute path to the pipeline run log. */
export const LOG_PATH: string = path.resolve(process.cwd(), 'data', 'pipeline.log');

/** Reads data/sources.json and returns only sources where active === true. */
export function loadSources(): Source[] {
  const raw = fs.readFileSync(SOURCES_PATH, 'utf-8');
  const all: Source[] = JSON.parse(raw);
  return all.filter((s) => s.active === true);
}
