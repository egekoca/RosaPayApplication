import {useAppStore} from '../state/appStore';

/**
 * The languages the app is offered in.
 *
 * English is the default because it is the language every string was written
 * in, and a half-translated screen reads worse than an untranslated one.
 * Turkish is here because the money this app is built around is lira and the
 * people counting in it should not have to read about it in English.
 */
export const LANGUAGES = [
  {code: 'en', flag: '🇬🇧', name: 'English', endonym: 'English'},
  {code: 'tr', flag: '🇹🇷', name: 'Turkish', endonym: 'Türkçe'},
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export function languageMeta(code: string) {
  return LANGUAGES.find(entry => entry.code === code) ?? LANGUAGES[0];
}

/**
 * The Turkish strings, keyed by the English they replace.
 *
 * Keying on the source text rather than on invented identifiers means an
 * untranslated string still says something true — it falls through as the
 * English it already was — and a translator can read the file without holding
 * the app in their head. The cost is that editing an English string silently
 * drops its translation, which `missingTranslations` is here to catch.
 */
const TR: Record<string, string> = {
  'BUSINESS EMAIL': 'İŞLETME E-POSTASI',
  'Enter a valid business email address': 'Geçerli bir işletme e-posta adresi girin',
  // Recovering a wallet after losing the phone that held it
  RECOVER: 'KURTARMA',
  'Recover your wallet': 'Cüzdanını kurtar',
  'I lost my phone': 'Telefonumu kaybettim',
  'Bring your wallet to this phone': 'Cüzdanını bu telefona getir',
  'There is nothing to type': 'Yazılacak hiçbir şey yok',
  'Your old phone held a key that could never leave it, so there was never a phrase to write down. Your passkey is what carries the wallet across.':
    'Eski telefonun, ondan asla çıkamayan bir anahtar tutuyordu; bu yüzden yazılacak bir kelime dizisi hiç olmadı. Cüzdanı taşıyan şey passkey’in.',
  'This phone makes a new key': 'Bu telefon yeni bir anahtar üretir',
  'It is created here and stays here, exactly as the old one did.':
    'Burada üretilir ve burada kalır, tıpkı eskisi gibi.',
  'The old key stops working': 'Eski anahtar çalışmaz olur',
  'Whoever finds your old phone cannot spend from this wallet afterwards.':
    'Eski telefonunu bulan kişi, bundan sonra bu cüzdandan harcama yapamaz.',
  'WALLET FOUND': 'CÜZDAN BULUNDU',
  'Approving moves it to this phone. Nothing is spent.':
    'Onaylamak cüzdanı bu telefona taşır. Hiçbir harcama yapılmaz.',
  'Find my wallet': 'Cüzdanımı bul',
  'Move it to this phone': 'Bu telefona taşı',
  'Something went wrong. Try again.': 'Bir şeyler ters gitti. Tekrar dene.',
  'This phone has no passkey for a Rosa Pay wallet. Sign in on a phone that does, or create a new wallet.':
    'Bu telefonda bir Rosa Pay cüzdanına ait passkey yok. Passkey’in olduğu bir telefondan gir ya da yeni bir cüzdan oluştur.',
  'That passkey does not belong to a Rosa Pay wallet.':
    'Bu passkey bir Rosa Pay cüzdanına ait değil.',
  'You dismissed the prompt, so nothing was changed.':
    'İstemi kapattın, bu yüzden hiçbir şey değişmedi.',
  'The wallet could not be moved to this phone. Nothing was changed; try again.':
    'Cüzdan bu telefona taşınamadı. Hiçbir şey değişmedi; tekrar dene.',
  'No password to remember. Your phone holds a key it cannot give away, and a passkey brings it back if the phone is lost.':
    'Hatırlanacak parola yok. Telefonun, kimseye veremeyeceği bir anahtar tutar; telefon kaybolursa passkey onu geri getirir.',

  // Paying with an asset the merchant did not ask for
  'PAYING WITH': 'ÖDEME KAYNAĞI',
  'via Soroswap': 'Soroswap ile',
  'Checking what this wallet can pay with…': 'Bu cüzdanın neyle ödeyebileceği kontrol ediliyor…',
  'Exchanged for the': 'Şuna çevrilir:',
  'the merchant asked for, at': 'esnafın istediği tutar, kur:',
  'You will never pay more than': 'Şundan fazlasını asla ödemezsin:',
  'Held directly in this wallet.': 'Doğrudan bu cüzdanda tutuluyor.',
  'This wallet cannot cover this request in': 'Bu cüzdan bu isteği şununla karşılayamaz:',
  'or in anything it can be exchanged for.': 'ya da çevrilebileceği başka bir şeyle.',

  // Wallet
  'Scan to pay': 'Okut ve öde',
  'Scan a code or hold phones together': 'Kodu okut ya da telefonları birbirine yaklaştır',
  Assets: 'Varlıklar',
  Payments: 'Ödemeler',
  'No payments yet': 'Henüz ödeme yok',
  'Your payment history will appear here.': 'Ödeme geçmişiniz burada görünecek.',
  'Get paid with this account': 'Bu hesapla ödeme al',
  'Stellar Lumens': 'Stellar Lumens',
  'USD Coin': 'USD Coin',
  'Show balance in': 'Bakiyeyi şu para biriminde göster',
  'Finish wallet setup': 'Cüzdan kurulumunu tamamla',
  'Create the wallet': 'Cüzdanı oluştur',

  // Lira
  'Add money': 'Para yükle',
  'Add money with Turkish lira': 'Türk Lirası ile para yükle',
  'Bank transfer · receive USDC in your wallet': 'Banka havalesi · hesabınıza USDC olarak geçer',
  'Cash out': 'Paraya çevir',
  'Add lira': 'Lira yükle',
  'YOU SEND': 'GÖNDERDİĞİNİZ',
  'YOU GET': 'ALDIĞINIZ',
  Continue: 'Devam',
  'Send and cash out': 'Gönder ve paraya çevir',
  'Reading the rate…': 'Kur okunuyor…',
  fee: 'komisyon',
  'SEND TO': 'ŞURAYA GÖNDERİN',
  'REFERENCE (AÇIKLAMA)': 'AÇIKLAMA',
  'Write this in the transfer description. It is what routes the money to your wallet.':
    'Havale açıklamasına bunu yazın. Parayı cüzdanınıza yönlendiren şey budur.',
  STATUS: 'DURUM',
  'Waiting for your bank transfer': 'Banka havaleniz bekleniyor',
  'The anchor has your lira and is converting it': 'Anchor liranızı aldı, çeviriyor',
  'The anchor has your USDC and is paying the lira out': 'Anchor USDC’nizi aldı, lirayı ödüyor',
  'Sending the USDC to your wallet': 'USDC cüzdanınıza gönderiliyor',
  Done: 'Tamamlandı',
  'The anchor could not finish this transfer': 'Anchor bu transferi tamamlayamadı',
  'Simulate the bank transfer': 'Banka havalesini simüle et',
  'Go back': 'Geri dön',

  // Profile
  Profile: 'Profil',
  Wallet: 'Cüzdan',
  ACCOUNT: 'HESAP',
  'WALLET ADDRESS': 'CÜZDAN ADRESİ',
  LANGUAGE: 'DİL',
  'App language': 'Uygulama dili',
  'Developer settings': 'Geliştirici ayarları',
  'Sign out': 'Çıkış yap',
  'Erases this account and its key from this phone.':
    'Bu hesabı ve anahtarını bu telefondan siler.',
  'No email': 'E-posta yok',
  'Copy address': 'Adresi kopyala',
  // Welcome and setup
  'Pay by scanning.': 'Okut ve öde.',
  'Settle on Stellar.': 'Stellar üzerinde ödeş.',
  'One app for both sides of the counter. Your money moves on Stellar, and only this phone can approve it.':
    'Tezgâhın iki tarafı için tek uygulama. Paranız Stellar üzerinde hareket eder ve yalnızca bu telefon onaylayabilir.',
  "Scan a merchant's code to pay": 'Ödemek için satıcının kodunu okutun',
  'Or hold the two phones together': 'Ya da iki telefonu birbirine yaklaştırın',
  'Approved with your face or fingerprint': 'Yüzünüz veya parmak izinizle onaylanır',
  'Create a new wallet': 'Yeni cüzdan oluştur',
  'I already have a wallet': 'Zaten cüzdanım var',
  'No password to remember. Twelve words are your wallet, and they are what lets you add money in lira.':
    'Ezberlenecek parola yok. On iki kelime cüzdanınızdır ve lira yüklemenizi sağlayan şey odur.',
  'Set up your account': 'Hesabınızı kurun',
  'Restore your wallet': 'Cüzdanınızı geri yükleyin',
  'Your name': 'Adınız',
  'Email (optional)': 'E-posta (isteğe bağlı)',
  'Only used to send you a receipt. It is not a login.':
    'Yalnızca makbuz göndermek için. Giriş bilgisi değildir.',
  'Your name is what a merchant sees on a receipt. Everything else stays on this phone.':
    'Satıcı makbuzda adınızı görür. Kalan her şey bu telefonda kalır.',
  'Twelve words are your wallet': 'On iki kelime cüzdanınızdır',
  'Your existing wallet': 'Mevcut cüzdanınız',
  'That does not look like an email address': 'Bu bir e-posta adresine benzemiyor',
  'Please enter the name a merchant should see': 'Satıcının göreceği adı girin',

  // Recovery phrase
  'Your recovery phrase': 'Kurtarma cümleniz',
  'These twelve words are your wallet. Write them down on paper, in this order, and keep them somewhere only you can reach.':
    'Bu on iki kelime cüzdanınızdır. Kâğıda bu sırayla yazın ve yalnızca sizin ulaşabileceğiniz bir yerde saklayın.',
  'I have written them down': 'Yazdım',
  'Check your phrase': 'Cümlenizi doğrulayın',
  'Tap the word that belongs in each place.': 'Her sıraya ait kelimeye dokunun.',
  'Create my wallet': 'Cüzdanımı oluştur',
  'Show the words again': 'Kelimeleri tekrar göster',

  // Import
  'Recovery phrase': 'Kurtarma cümlesi',
  'Secret key': 'Gizli anahtar',
  'Enter the recovery phrase from your existing Stellar wallet. It never leaves this phone.':
    'Mevcut Stellar cüzdanınızın kurtarma cümlesini girin. Bu telefondan asla çıkmaz.',
  'The key that starts with an S, not the address that starts with a G':
    'G ile başlayan adres değil, S ile başlayan anahtar',
  'Is this your account?': 'Hesabınız bu mu?',
  'Yes, use this wallet': 'Evet, bu cüzdanı kullan',
  'No, let me check again': 'Hayır, tekrar kontrol edeyim',
  'STELLAR ACCOUNT': 'STELLAR HESABI',

  // Unlock
  'Set up this device again': 'Bu cihazı yeniden kur',
  'Welcome back': 'Tekrar hoş geldiniz',

  // Scan and pay
  'Allow camera access': 'Kamera erişimine izin ver',
  'Retry camera': 'Kamerayı tekrar dene',
  "QR is the universal payment path on iOS and Android.": 'QR, iOS ve Android’de ortak ödeme yoludur.',
  "Scan this device's request": 'Bu cihazın isteğini okut',
  "You can also hold this phone against the merchant's":
    'Telefonu satıcınınkine de yaklaştırabilirsiniz',
  'Turn on paying by holding phones together': 'Telefonları yaklaştırarak ödemeyi aç',
  'Allow Bluetooth in Settings': 'Ayarlar’dan Bluetooth’a izin ver',
  'Switch Bluetooth on to pay by holding phones together': 'Telefon yaklaştırarak ödemek için Bluetooth’u aç',
  'Not allowed yet': 'Henüz izin verilmedi',
  'New payment': 'Yeni ödeme',
  'Listening for a counter nearby': 'Yakındaki kasa dinleniyor',
  'Bluetooth not allowed yet': 'Bluetooth’a henüz izin verilmedi',
  'Bluetooth is switched off': 'Bluetooth kapalı',
  'This phone has no Bluetooth LE': 'Bu telefonda Bluetooth LE yok',
  'Show more': 'Daha fazla göster',
  'Show the code again': 'Kodu tekrar göster',
  Active: 'Aktif',
  Accept: 'Kabul et',
  'into this wallet': 'bu cüzdana',
  Opening: 'Açılıyor',
  'Open your counter and ask for a payment': 'Kasanı aç ve ödeme iste',
  'Set up your counter and take your first payment': 'Kasanı kur ve ilk ödemeni al',
  'Switched off': 'Kapalı',
  'Not on this device': 'Bu cihazda yok',
  'Rosa Pay finds the merchant you are standing at, and nothing else.': 'Rosa Pay yalnızca önünde durduğunuz satıcıyı bulur, başka hiçbir şeyi değil.',
  "Hold this phone against the merchant's": 'Bu telefonu satıcınınkine yaklaştırın',
  'Payment request could not be verified': 'Ödeme isteği doğrulanamadı',
  OK: 'Tamam',
  // The brand line, the same one the website is titled with. Kept to three
  // words in Turkish too: it sits under the name as a mark, not a sentence.
  'Scan. Approve. Settled.': 'Okut. Onayla. Tamamlandı.',
  'YOUR BALANCE': 'BAKİYENİZ',
  'Reading your balance…': 'Bakiyeniz okunuyor…',
  'Balance unavailable right now': 'Bakiye şu an alınamıyor',
  'YOU ARE PAYING': 'ÖDEYECEĞİNİZ',
  'SECURE CHECKOUT': 'GÜVENLİ ÖDEME',
  Recipient: 'Alıcı',
  Asset: 'Varlık',
  Issuer: 'İhraççı',
  Network: 'Ağ',
  Expires: 'Son geçerlilik',
  'Long-press the recipient or issuer to copy it.':
    'Kopyalamak için alıcıya veya ihraççıya uzun basın.',
  'The merchant signature failed verification. Ask for a new payment request.':
    'Satıcı imzası doğrulanamadı. Yeni bir ödeme isteği isteyin.',

  // Receipt
  'PAYMENT COMPLETE': 'ÖDEME TAMAMLANDI',
  Status: 'Durum',
  CONFIRMED: 'ONAYLANDI',
  Ledger: 'Defter',
  Transaction: 'İşlem',
  'Intent ID': 'İstek kimliği',
  'Confirmed at': 'Onay zamanı',
  'View on Explorer': 'Explorer’da görüntüle',
  'Share receipt': 'Makbuzu paylaş',

  // Activity
  Activity: 'Hareketler',
  'Filter activity': 'Hareketleri filtrele',
  PAYMENTS: 'ÖDEMELER',

  // Dashboard
  Dashboard: 'Gösterge paneli',
  OVERVIEW: 'GENEL BAKIŞ',
  'TOTAL RECEIVED': 'TOPLAM ALINAN',
  'TOTAL PAYMENTS': 'TOPLAM ÖDEME',
  'Confirmed merchant payments': 'Doğrulanmış satıcı ödemeleri',
  'Confirmed payments on this phone': 'Bu telefondaki doğrulanmış ödemeler',
  'PAYMENT CHANNELS': 'ÖDEME KANALLARI',
  'QR RECEIVED': 'QR İLE ALINAN',
  'HELD TOGETHER': 'YAKLAŞTIRARAK ALINAN',
  'MONEY MOVEMENT': 'PARA HAREKETİ',
  'Money deposited': 'Para yatırma',
  'Money withdrawn': 'Para çekme',
  transfers: 'transfer',
  confirmed: 'doğrulandı',
  'Channel totals reflect confirmed activity saved on this device.':
    'Kanal toplamları bu cihazda kaydedilen doğrulanmış hareketleri gösterir.',

  // Merchant
  'GET PAID': 'ÖDEME AL',
  'Set up your business': 'İşletmenizi kurun',
  'Customers see this name. You are paid into the wallet you already have.':
    'Müşteriler bu adı görür. Ödeme, hâlihazırdaki cüzdanınıza yapılır.',
  'BUSINESS NAME': 'İŞLETME ADI',
  'RECEIVING ADDRESS': 'ALICI ADRES',
  'Paid into this wallet': 'Bu cüzdana ödenir',
  'Stellar account or contract address that receives payments':
    'Ödemeleri alan Stellar hesabı veya kontrat adresi',
  'The address is checked before it can ever appear on a payment request.':
    'Adres, bir ödeme isteğinde görünmeden önce doğrulanır.',
  'Verify and continue': 'Doğrula ve devam et',
  'Registering on Testnet': 'Testnet’e kaydediliyor',
  // Screen titles in the header bar, which is the one place a stray English
  // word sits above an otherwise Turkish screen.
  'Business profile': 'İşletme profili',
  'Anchor transfer': 'Anchor transferi',
  'Payment request': 'Ödeme isteği',
  'Enter what the customer owes': 'Müşterinin borcunu girin',
  'Show this code to your customer': 'Bu kodu müşterinize gösterin',
  Registering: 'Kaydediliyor',
  'PAID IN': 'ÖDEME BİRİMİ',
  'PRICED IN': 'FİYAT BİRİMİ',
  // The one control that replaced those two: a merchant is asked what they are
  // typing the price in, whether that is an asset or a currency.
  'PRICE IN': 'FİYAT BİRİMİ',
  'Name this price in': 'Bu fiyatı şu birimde belirt',
  'CUSTOMER SENDS': 'MÜŞTERİ GÖNDERİR',
  REFERENCE: 'AÇIKLAMA',
  'Create payment request': 'Ödeme isteği oluştur',
  'New request': 'Yeni istek',
  'Preview customer view': 'Müşteri görünümünü önizle',
  'PAYMENT STATUS': 'ÖDEME DURUMU',
  'Not registered on Testnet': 'Testnet’e kayıtlı değil',
  'Register this business': 'Bu işletmeyi kaydet',
  'The settlement contract only accepts requests from a registered merchant key.':
    'Ödeşme kontratı yalnızca kayıtlı bir satıcı anahtarından gelen istekleri kabul eder.',
  'Set up business': 'İşletmeyi kur',
  'Set up your business profile before creating a payment request.':
    'Ödeme isteği oluşturmadan önce işletme profilinizi kurun.',
  'Recent payments': 'Son ödemeler',
  // The countdown over the code, and what a merchant reads off a row in the
  // list below it. Both say whether money is still coming, so both are read at
  // a glance and neither can afford to be in a language the counter is not in.
  'left to pay': 'süre kaldı',
  'Checking how long this is valid': 'Ne kadar geçerli olduğu kontrol ediliyor',
  'This phone did not approve the request. Press retry and answer the prompt.':
    'Bu telefon isteği onaylamadı. Tekrar dene ve çıkan istemi yanıtla.',
  'Business status': 'İşletme durumu',
  SETTLED: 'ÖDEŞTİ',
  OPEN: 'AÇIK',
  'ACTIVE QR': 'AKTİF QR',
  BUSINESS: 'İŞLETME',
  Pay: 'Öde',
  'Get paid': 'Ödeme al',

  // Card and errors
  'Copy wallet address': 'Cüzdan adresini kopyala',
  'SETUP REQUIRED': 'KURULUM GEREKLİ',
  READING: 'OKUNUYOR',
  RECONNECTING: 'YENİDEN BAĞLANIYOR',
  'Rosa Pay needs a fresh start': 'Rosa Pay’in yeniden başlaması gerekiyor',
  'Your wallet and payment authorization were not changed.':
    'Cüzdanınız ve ödeme yetkiniz değişmedi.',
  'Try again': 'Tekrar dene',
  'Lira needs a recovery-phrase wallet': 'Lira için kurtarma cümlesi cüzdanı gerekir',
  'PAID OUT TO': 'ŞURAYA ÖDENDİ',
  // Shared status and navigation copy
  'Open active request': 'Aktif isteği aç',
  'Payment received': 'Ödeme alındı',
  'Create a request and keep this screen open at the counter.':
    'Bir istek oluşturun ve bu ekranı tezgâhta açık tutun.',
  'This account has no wallet yet. Twelve words will make one, and they are what lets you add money in lira.':
    'Bu hesapta henüz cüzdan yok. On iki kelime bir cüzdan oluşturur ve lira yüklemenizi sağlar.',
  'Türk Lirası ile para yükle': 'Türk Lirası ile para yükle',
  'Banka havalesi · hesabınıza USDC olarak geçer': 'Banka havalesi · hesabınıza USDC olarak geçer',
  'Receiving address verified': 'Alıcı adresi doğrulandı',
  'Verification in progress': 'Doğrulama sürüyor',
  'No address on file': 'Kayıtlı adres yok',
  'Payment · Stellar Testnet': 'Ödeme · Stellar Testnet',
  'TOTAL PAID': 'TOPLAM ÖDEME',
  'PAID ON-CHAIN': 'ZİNCİRDE ÖDENEN',
  'DEMO TOTAL': 'DEMO TOPLAMI',
  'LOCAL': 'YEREL',
  'SYNCING': 'EŞİTLENİYOR',
  'LIVE': 'CANLI',
  'READY': 'HAZIR',
  'ACTION': 'İŞLEM GEREKLİ',
  // Scan and payment confirmation
  'Align the merchant QR inside the frame': 'Satıcının QR kodunu çerçevenin içine hizalayın',
  'Starting the camera': 'Kamera başlatılıyor',
  'Rosa Pay needs the camera to read a merchant QR': 'Rosa Pay, satıcı QR kodunu okumak için kameraya ihtiyaç duyar',
  'No camera on this device — use the request below': 'Bu cihazda kamera yok — aşağıdaki isteği kullanın',
  'No camera on this device. Make a request in Get paid to try a payment here.':
    'Bu cihazda kamera yok. Burada ödeme denemek için Ödeme al bölümünden bir istek oluşturun.',
  'The camera could not start. Check camera access and try again.':
    'Kamera başlatılamadı. Kamera erişimini kontrol edip tekrar deneyin.',
  'Review payment': 'Ödemeyi incele',
  TESTNET: 'TESTNET',
  VERIFIED: 'DOĞRULANDI',
  UNVERIFIED: 'DOĞRULANMADI',
  'Signature matches this merchant key': 'İmza bu satıcı anahtarıyla eşleşiyor',
  'Signature does not match this merchant key': 'İmza bu satıcı anahtarıyla eşleşmiyor',
  'Native XLM': 'Yerel XLM',
  'Stellar Testnet': 'Stellar Testnet',
  'Stellar Public': 'Stellar Public',
  'This request cannot be authorized.': 'Bu istek onaylanamaz.',
  'Your device will authorize this exact amount.': 'Cihazınız bu tam tutarı onaylayacak.',
  'This request expired at ledger': 'Bu isteğin süresi şu defterde doldu',
  'Ask for a new one.': 'Yeni bir istek isteyin.',
  'Sent to Stellar:': 'Stellar’a gönderildi:',
  'Approve payment': 'Ödemeyi onayla',
  'Retry payment': 'Ödemeyi yeniden dene',
  'The wallet balance could not be verified, so this payment is paused.': 'Cüzdan bakiyesi doğrulanamadı; ödeme bekletiliyor.',
  'Retry balance check': 'Bakiye kontrolünü yeniden dene',
  'Testnet is unavailable, so this request expiry cannot be verified.': 'Testnet kullanılamıyor; isteğin süresi doğrulanamıyor.',
  'Authorizing on this device': 'Bu cihazda onaylanıyor',
  'Preparing authorization': 'Onay hazırlanıyor',
  'Sending to the relayer': 'Aktarıcıya gönderiliyor',
  'Waiting for the ledger': 'Defter bekleniyor',
  'Confirmed': 'Onaylandı',
  'The exact amount and recipient are ready for device authorization.': 'Tam tutar ve alıcı cihaz onayına hazır.',
  'Your authorization is locked. The relayer cannot change the payment.': 'Onayınız kilitlendi. Aktarıcı ödemeyi değiştiremez.',
  'The transaction is submitted. Waiting for a final Stellar ledger result.': 'İşlem gönderildi. Kesin Stellar defter sonucu bekleniyor.',
  'The payment reached a confirmed Stellar ledger.': 'Ödeme onaylanmış bir Stellar defterine ulaştı.',
  'Approve the exact payment with your device security.': 'Tam ödemeyi cihaz güvenliğinizle onaylayın.',
  Expired: 'Süresi doldu',
  'network unreachable': 'ağa ulaşılamıyor',
  'ledgers left': 'defter kaldı',
  'min': 'dk',
  'Payment confirmed': 'Ödeme onaylandı',
  'Your payment to': 'Şu alıcıya ödemeniz',
  'was confirmed on Stellar.': 'Stellar üzerinde onaylandı.',
  'At ledger': 'Şu defterde',
  about: 'yaklaşık',
  // Ramp details
  'The anchor’s bank': 'Anchor’ın bankası',
  'USDC has been sent to the anchor. It pays the lira out once it sees the payment.':
    'USDC anchor’a gönderildi. Ödemeyi gördüğünde lirayı hesabınıza yatırır.',
  'USDC arrived in this wallet.': 'USDC bu cüzdana ulaştı.',
  'TRY was paid out.': 'TRY ödendi.',
  'That could not be started': 'Bu işlem başlatılamadı',
  'The sandbox bank did not answer': 'Sandbox bankası yanıt vermedi',
  // Developer settings
  'What this device is talking to, and the key it signs with.': 'Bu cihazın bağlandığı servis ve imza attığı anahtar.',
  Checking: 'Kontrol ediliyor',
  Unavailable: 'Kullanılamıyor',
  'Not reachable': 'Ulaşılamıyor',
  'No profile': 'Profil yok',
  Registered: 'Kayıtlı',
  'Not registered': 'Kayıtlı değil',
  'API storage': 'API depolaması',
  'Session storage': 'Oturum depolaması',
  'Device wallet': 'Cihaz cüzdanı',
  'Merchant on-chain': 'Zincirde satıcı',
  'Ask for me when the app opens': 'Uygulama açıldığında benden onay iste',
  'Off by default. Paying always asks, whatever this says.': 'Varsayılan olarak kapalıdır. Ödeme her zaman onay ister.',
  'API ADDRESS': 'API ADRESİ',
  "On a phone, use your computer's network address, such as http://192.168.1.10:4100":
    'Telefonda bilgisayarınızın ağ adresini kullanın; örneğin http://192.168.1.10:4100',
  'Use this address': 'Bu adresi kullan',
  'A phone cannot reach localhost on your computer; use its network address.': 'Telefon, bilgisayarınızdaki localhost’a ulaşamaz; ağ adresini kullanın.',
  'That address could not be used': 'Bu adres kullanılamadı',
  'PostgreSQL · records kept': 'PostgreSQL · kayıtlar korunuyor',
  'In memory · lost on restart': 'Bellekte · yeniden başlatmada silinir',
  unknown: 'bilinmiyor',
  'Not written yet': 'Henüz yazılmadı',
  Restored: 'Geri yüklendi',
  'Saved on this device': 'Bu cihaza kaydedildi',
  'No wallet on this device yet': 'Bu cihazda henüz cüzdan yok',
  'Good morning': 'Günaydın',
  'Good afternoon': 'Tünaydın',
  'Good evening': 'İyi akşamlar',
  'your fingerprint': 'parmak iziniz',
  'ROSA PAY': 'ROSA PAY',
  'Scan QR': 'QR okut',
  Receipt: 'Makbuz',
  'Enter a price in': 'Şu para biriminde fiyat girin',
  'to convert': 'dönüştürmek için',
  Rate: 'Kur',
  'Customer sends': 'Müşteri gönderir',
  per: 'başına',
  'Reading the Testnet ledger': 'Testnet defteri okunuyor',
  'Testnet unavailable, so an expiry cannot be set': 'Testnet kullanılamıyor; süre sonu ayarlanamaz',
  // Paying with no network: the customer's side, then the merchant's.
  'No connection. Hold this phone against the merchant’s to pay without one.':
    'Bağlantı yok. Bağlantısız ödemek için telefonu satıcınınkine yaklaştırın.',
  'This phone needs no connection. The merchant submits it and tells you what the ledger said.':
    'Bu telefonun bağlantıya ihtiyacı yok. Ödemeyi satıcı gönderir ve defterin ne dediğini size söyler.',
  'Reaching the merchant': 'Satıcıya ulaşılıyor',
  'Hold this phone near the merchant until it answers.':
    'Satıcı yanıt verene kadar telefonu ona yakın tutun.',
  'Telling the merchant who is paying': 'Satıcıya kimin ödediği bildiriliyor',
  'The payment names who pays, so the merchant needs this phone first.':
    'Ödeme kimin ödediğini yazar; bu yüzden satıcının önce bu telefona ihtiyacı var.',
  'Waiting for the exact payment': 'Tam ödeme bekleniyor',
  'The merchant is preparing the exact call this device will sign.':
    'Satıcı, bu cihazın imzalayacağı tam çağrıyı hazırlıyor.',
  'Checked against the request on screen. Nothing here needs a network.':
    'Ekrandaki isteğe karşı doğrulandı. Buradaki hiçbir şey ağa ihtiyaç duymuyor.',
  'The merchant is sending it to Stellar': 'Satıcı bunu Stellar’a gönderiyor',
  'Your signature has crossed over. The merchant pays the fee and submits it.':
    'İmzanız karşıya geçti. Ücreti satıcı ödüyor ve işlemi gönderiyor.',
  'The merchant saw it reach a Stellar ledger.':
    'Satıcı, ödemenin bir Stellar defterine ulaştığını gördü.',
  'A customer is paying without a network. Preparing what their phone must sign.':
    'Bir müşteri ağsız ödüyor. Telefonunun imzalaması gereken şey hazırlanıyor.',
  'Waiting for the customer to approve on their phone.':
    'Müşterinin kendi telefonunda onaylaması bekleniyor.',
  'Approved. Submitting it to Stellar and paying the fee.':
    'Onaylandı. Stellar’a gönderiliyor ve ücret ödeniyor.',
  'Paid without the customer ever connecting.':
    'Müşteri hiç bağlanmadan ödeme tamamlandı.',
  'This wallet last held': 'Bu cüzdanda en son şu kadar vardı:',
  'The merchant will refuse this if it is still short.':
    'Hâlâ yetersizse satıcı bu ödemeyi reddedecek.',
  'Expires about 5 minutes after ledger': 'Defterden yaklaşık 5 dakika sonra sona erer',
  'Preparing payment request': 'Ödeme isteği hazırlanıyor',
  'Register this business before creating a payment request': 'Ödeme isteği oluşturmadan önce işletmeyi kaydedin',
  PUBLISHING: 'YAYINLANIYOR',
  'Publishing payment request': 'Ödeme isteği yayımlanıyor',
  'This request is not published': 'Bu istek yayımlanmadı',
  'Checking payment request': 'Ödeme isteği kontrol ediliyor',
  'The API did not confirm the request. Retry before asking a customer to pay.': 'API isteği doğrulamadı. Müşteriden ödeme almadan önce yeniden deneyin.',
  'Or let the customer hold their phone against this one': 'Ya da müşteri telefonunu buna yaklaştırsın',
  'Allow Bluetooth so an iPhone customer can pay by holding their phone here': 'iPhone müşteri telefonunu yaklaştırarak ödeyebilsin diye Bluetooth’a izin verin',
  'Turn on Bluetooth so an iPhone customer can pay by holding their phone here': 'iPhone müşteri telefonunu yaklaştırarak ödeyebilsin diye Bluetooth’u açın',
  'Holding phones together is unavailable right now; use the QR code': 'Telefonları yaklaştırma şu anda kullanılamıyor; QR kodunu kullanın',
  'Preparing to be held against': 'Yaklaştırmaya hazırlanıyor',
  Retry: 'Yeniden dene',
  'Allow Bluetooth': 'Bluetooth’a izin ver',
  'Retry publish': 'Yayını yeniden dene',
  'REFERENCE (OPTIONAL)': 'AÇIKLAMA (İSTEĞE BAĞLI)',
  'The merchant did not approve this payment in time. Ask them to show the request again.':
    'Satıcı bu ödemeyi zamanında onaylamadı. İsteği yeniden göstermesini isteyin.',
  'Someone else is already paying this request. Ask the merchant for a new one.':
    'Bu isteği başka biri ödüyor. Satıcıdan yeni bir istek isteyin.',
  'The merchant has not published this request, so it cannot be approved.':
    'Satıcı bu isteği yayımlamadı, bu yüzden onaylanamıyor.',
  'This phone could not sign in to the Rosa Pay API, so the merchant was never asked to approve.':
    'Bu telefon Rosa Pay API’sine giriş yapamadı; satıcıya onay hiç sorulmadı.',
  'This deployment will not let this wallet claim a request. Update the API, or pay from a wallet this app created.':
    'Bu dağıtım bu cüzdanın istek talep etmesine izin vermiyor. API’yi güncelleyin ya da bu uygulamanın oluşturduğu bir cüzdandan ödeyin.',
  'The merchant could not approve this payment.': 'Satıcı bu ödemeyi onaylayamadı.',
  'Use the hosted address': 'Yayındaki adresi kullan',
  'This address is a development machine, so this phone reaches nothing.':
    'Bu adres bir geliştirme makinesi; bu telefon hiçbir yere ulaşamıyor.',
  // The detail a merchant opens from a row in Recent payments.
  PAID: 'ÖDENDİ',
  DECLINED: 'REDDEDİLDİ',
  WAITING: 'BEKLİYOR',
  'IN PROGRESS': 'İŞLENİYOR',
  'This payment settled on Stellar Testnet.': 'Bu ödeme Stellar Testnet üzerinde tamamlandı.',
  'Nobody paid this before its five minutes were up. Make a new request to be paid for it.':
    'Beş dakikası dolmadan kimse ödemedi. Tahsil etmek için yeni bir istek oluşturun.',
  'The customer declined this request.': 'Müşteri bu isteği reddetti.',
  'This payment could not settle. Nothing left the customer’s wallet.':
    'Bu ödeme tamamlanamadı. Müşterinin cüzdanından hiçbir şey çıkmadı.',
  'Waiting for a customer. Show the QR or let them hold their phone against yours.':
    'Müşteri bekleniyor. QR’ı gösterin ya da telefonunu sizinkine yaklaştırsın.',
  Created: 'Oluşturuldu',
  Request: 'İstek',
  Close: 'Kapat',
  'Table 08, order number, anything': 'Masa 08, sipariş no, ne isterseniz',
  'This payment request is closed': 'Bu ödeme isteği kapandı',
  Price: 'Fiyat',
  'Show QR': 'QR göster',
  Paid: 'Ödendi',
  'A customer has paid this request': 'Bir müşteri bu isteği ödedi',
  'Expires at ledger': 'Şu defterde sona erer',
  'This request has expired': 'Bu isteğin süresi doldu',
  PENDING: 'BEKLİYOR',
  EXPIRED: 'SÜRESİ DOLDU',
  Word: 'Kelime',
  'That is not the phrase on the last screen. Go back and check it again.': 'Bu, son ekrandaki cümle değil. Geri dönüp tekrar kontrol edin.',
  'Anyone with these words can spend your money. Nobody at Rosa Pay can see them, and nobody can give them back to you if they are lost.': 'Bu kelimelere sahip herkes paranızı harcayabilir. Rosa Pay’de kimse bunları göremez ve kaybolursa size geri veremez.',
  'The next screen asks for your recovery phrase. It opens the same account you already use in another wallet, and the address is shown for you to check before anything is saved.': 'Sonraki ekran kurtarma cümlenizi ister. Başka bir cüzdanda kullandığınız hesabı açar; hiçbir şey kaydedilmeden önce adresi kontrol edebilirsiniz.',
  'The next screen shows them once. They open this same account in Rosa Pay, Lobstr or Freighter, they are what lets you add money in lira, and they are the only way back if you lose this phone. Nobody can reissue them.': 'Sonraki ekran bunları bir kez gösterir. Rosa Pay, Lobstr veya Freighter’da aynı hesabı açarlar; lira yüklemenizi sağlarlar ve bu telefonu kaybederseniz geri dönmenin tek yoludur. Kimse onları yeniden veremez.',
  'Check this against the address in the wallet you are moving from. If it does not match, the phrase belongs to a different account and nothing has been saved yet.': 'Bunu para taşıdığınız cüzdandaki adresle karşılaştırın. Eşleşmiyorsa cümle başka bir hesaba aittir ve henüz hiçbir şey kaydedilmemiştir.',
  'Usually twelve words, in order': 'Genellikle sıralı on iki kelime',
  'of 12 words': ' / 12 kelime',
  'This phone needs a screen lock before it can hold a wallet key. Set one, then try again.': 'Bu telefonun cüzdan anahtarını tutması için ekran kilidi gerekir. Ayarlayıp tekrar deneyin.',
  'That wallet could not be read': 'Bu cüzdan okunamadı',
  'Your account could not be created': 'Hesabınız oluşturulamadı',
  'The wallet could not be saved on this phone': 'Cüzdan bu telefona kaydedilemedi',
  'The anchor verifies a wallet by having it sign a challenge, which only an ordinary Stellar account can do. This phone\'s wallet lives in its secure hardware and has no key that can answer. Set this phone up again with a recovery phrase to move money in lira.': 'Anchor, cüzdanı yalnızca sıradan bir Stellar hesabının yapabileceği bir imza sınamasıyla doğrular. Bu telefonun cüzdanı güvenli donanımda yaşar ve yanıt verecek anahtarı yoktur. Lira taşımak için telefonu kurtarma cümlesiyle yeniden kurun.',
  'Only': 'Yalnızca',
  'in this wallet': 'bu cüzdanda',
  'Transfer reference': 'Transfer açıklaması',
  'Anchor IBAN': 'Anchor IBAN',
  'The account this phone already uses. Tap to be paid somewhere else instead.': 'Bu telefonun kullandığı hesap. Başka bir yere ödeme almak için dokunun.',
  'Your registered bank account': 'Kayıtlı banka hesabınız',
  'This device could not erase the payment key.': 'Bu cihaz ödeme anahtarını silemedi.',
  Unlock: 'Kilidi aç',
  'Use a different account': 'Farklı hesap kullan',
  'Tap again to erase this account and start over': 'Bu hesabı silip baştan başlamak için tekrar dokunun',
  'Tap again to erase': 'Silmek için tekrar dokunun',
  'This phone could not erase the key.': 'Bu telefon anahtarı silemedi.',
  'Unlock with': 'Şununla açın',
  'to see your balance and pay.': 'bakiyenizi görmek ve ödeme yapmak için.',
  'The merchant profile could not be created': 'Satıcı profili oluşturulamadı',
  'unknown error': 'bilinmeyen hata',
  'Testnet registration failed': 'Testnet kaydı başarısız oldu',
  'The request could not be published to the API': 'İstek API’ye yayımlanamadı',
  'The payment request could not be created': 'Ödeme isteği oluşturulamadı',
  'has no': 'şu yok:',
  'trustline, so a payment in it would not arrive. Add one, or receive into this phone instead.': 'trustline bulunmadığından ödeme ulaşmaz. Ekleyin veya bu telefona alın.',
  'Settled in ledger': 'Şu defterde ödeşti:',
  'Sent to Stellar, waiting for the ledger to confirm it.': 'Stellar’a gönderildi; defter onayı bekleniyor.',
  'The customer authorized this payment.': 'Müşteri bu ödemeyi onayladı.',
  'Settlement failed:': 'Ödeşme başarısız:',
  'unknown reason': 'bilinmeyen neden',
  'The API could not be reached, so the status is unknown here.': 'API’ye ulaşılamadı; durum burada bilinmiyor.',
  'Waiting for a customer to pay this request.': 'Bir müşterinin bu isteği ödemesi bekleniyor.',
  'Refreshing status...': 'Durum yenileniyor…',
  Unknown: 'Bilinmiyor',
  'AWAITING APPROVAL': 'ONAY BEKLİYOR',
  SUBMITTED: 'GÖNDERİLDİ',
  AUTHORIZED: 'ONAYLANDI',
  FAILED: 'BAŞARISIZ',
  REJECTED: 'REDDEDİLDİ',
  'The Rosa Pay relayer is unreachable, so no fee payer could sign. Nothing was sent.': 'Rosa Pay aktarıcısına ulaşılamadı; hiçbir şey gönderilmedi.',
  'This request was created on another device, so its merchant signature cannot be produced here.': 'Bu istek başka bir cihazda oluşturuldu; satıcı imzası burada üretilemez.',
  'This device wallet could not be funded on Testnet. Try again in a moment.': 'Bu cihaz cüzdanı Testnet’te fonlanamadı. Biraz sonra tekrar deneyin.',
  'The payment could not be settled. No funds were moved.': 'Ödeme ödeşmedi. Hiçbir para taşınmadı.',
  'This request is no longer valid: it has expired or targets another network.': 'Bu istek artık geçerli değil: süresi doldu veya başka bir ağı hedefliyor.',
  'The merchant signature does not match this request. Ask for a new payment request.': 'Satıcı imzası bu istekle eşleşmiyor. Yeni bir ödeme isteği isteyin.',
  'The merchant has not signed this exact payment for your wallet yet.': 'Satıcı bu tam ödemeyi cüzdanınız için henüz imzalamadı.',
  'No separate fee payer was available, so the payment was not attempted.': 'Ayrı bir ücret ödeyici yoktu; ödeme denenmedi.',
  'The payment could not be prepared. No funds were moved.': 'Ödeme hazırlanamadı. Hiçbir para taşınmadı.',
  'The contract refused to prepare this payment. It is most likely already settled or expired.': 'Kontrat bu ödemeyi hazırlamayı reddetti. Büyük olasılıkla zaten ödeşmiş veya süresi dolmuş.',
  'Stellar rejected the transaction, so nothing was settled.': 'Stellar işlemi reddetti; hiçbir şey ödeşmedi.',
  'The transaction was sent but never confirmed. Check the merchant before paying again.': 'İşlem gönderildi ancak onaylanmadı. Tekrar ödemeden önce satıcıyı kontrol edin.',
  'The payment could not be completed. No funds were moved.': 'Ödeme tamamlanamadı. Hiçbir para taşınmadı.',
  'You cancelled the authorization, so nothing was paid.': 'Onayı iptal ettiniz; hiçbir ödeme yapılmadı.',
  'This device could not authorize the payment. No funds were moved.': 'Bu cihaz ödemeyi onaylayamadı. Hiçbir para taşınmadı.',
  'This wallet does not have enough': 'Bu cüzdanda ödeme için yeterli',
  'for the payment. Top it up and try again.': 'yok. Bakiye ekleyip tekrar deneyin.',
  'This wallet is not funded on Stellar yet. Create or fund it from developer settings.': 'Bu cüzdan Stellar’da henüz fonlanmadı. Geliştirici ayarlarından oluşturun veya fonlayın.',
  'Stellar could not be reached, so nothing was submitted. Check the connection and try again.': 'Stellar’a ulaşılamadı; hiçbir şey gönderilmedi. Bağlantıyı kontrol edip tekrar deneyin.',
};

const CATALOGUES: Record<string, Record<string, string>> = {tr: TR};

/** Translates one string, falling through to the English it was written in. */
export function translate(text: string, language: string): string {
  return CATALOGUES[language]?.[text] ?? text;
}

/**
 * The translator for the current language.
 *
 * A hook rather than a global so a language change repaints, which is the
 * whole point of the setting.
 */
export function useTranslate(): (text: string) => string {
  const language = useAppStore(state => state.language);
  return text => translate(text, language);
}

/** Strings a catalogue has no entry for, so a test can name what is missing. */
export function missingTranslations(language: string, texts: readonly string[]): string[] {
  const catalogue = CATALOGUES[language];
  if (!catalogue) return [...texts];
  return texts.filter(text => catalogue[text] === undefined);
}
