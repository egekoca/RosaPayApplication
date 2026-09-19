import React, {type ErrorInfo, type ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, colors, spacing, typography} from '@rosapay/ui';
import {logger} from '../shared/logger';
import {translate} from '../shared/i18n';
import {useAppStore} from '../state/appStore';

type Props = {children: ReactNode};
type State = {hasError: boolean};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = {hasError: false};

  static getDerivedStateFromError(): State {
    return {hasError: true};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('app_render_failed', {message: error.message, componentStack: info.componentStack});
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>{translate('Rosa Pay needs a fresh start', useAppStore.getState().language)}</Text>
          <Text style={styles.body}>{translate('Your wallet and payment authorization were not changed.', useAppStore.getState().language)}</Text>
          <Button onPress={() => this.setState({hasError: false})}>{translate('Try again', useAppStore.getState().language)}</Button>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.canvas, gap: spacing.lg},
  title: {...typography.title, color: colors.ink},
  body: {...typography.body, color: colors.inkMuted},
});
