import {Share} from 'react-native';
import {logger} from './logger';

/**
 * React Native dropped Clipboard from core, and a clipboard module is a native
 * dependency; the share sheet is built in and lets the user copy, message or
 * save the value from one place.
 */
export async function shareValue(title: string, value: string): Promise<void> {
  try {
    await Share.share({title, message: value});
  } catch (error) {
    logger.error('share_failed', {title, message: error instanceof Error ? error.message : 'unknown'});
  }
}
