describe('API base URL', () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.ROSAPAY_API_URL;
  });

  it('reaches the host machine from the Android emulator', () => {
    jest.doMock('react-native', () => ({Platform: {OS: 'android'}}));
    const {apiBaseUrl} = require('../src/shared/apiConfig');
    expect(apiBaseUrl).toBe('http://10.0.2.2:4100');
  });

  it('uses the loopback address on iOS, where the simulator shares the host network', () => {
    jest.doMock('react-native', () => ({Platform: {OS: 'ios'}}));
    const {apiBaseUrl} = require('../src/shared/apiConfig');
    expect(apiBaseUrl).toBe('http://127.0.0.1:4100');
  });

  it('lets a deployment override the API location', () => {
    process.env.ROSAPAY_API_URL = 'https://api.rosapay.example';
    jest.doMock('react-native', () => ({Platform: {OS: 'ios'}}));
    const {apiBaseUrl} = require('../src/shared/apiConfig');
    expect(apiBaseUrl).toBe('https://api.rosapay.example');
  });
});
