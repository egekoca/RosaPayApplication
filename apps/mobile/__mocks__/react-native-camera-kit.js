/**
 * Stand-in for the native camera, so screen tests exercise the scanning logic
 * without a device. Tests drive `onReadCode` directly.
 */
const React = require('react');

const Camera = React.forwardRef((props, ref) => React.createElement('CKCamera', {...props, ref}));
Camera.displayName = 'Camera';

module.exports = {
  __esModule: true,
  default: {
    async requestDeviceCameraAuthorization() {
      return true;
    },
    async checkDeviceCameraAuthorizationStatus() {
      return true;
    },
  },
  Camera,
  CameraType: {Back: 'back', Front: 'front'},
};
