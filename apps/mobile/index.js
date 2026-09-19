/**
 * @format
 */

// Install the Buffer global before any module that depends on it is evaluated.
import './src/shared/polyfills';

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
