/**
 * JARVIS universal command registry.
 *
 * Every action JARVIS can take — media, browser, social media, any website,
 * system, window management — defined as tools the agent can call.
 *
 * Categories:
 *   media     — play, pause, skip, next, prev, mute, volume, seek
 *   browser   — open, close, tab, navigate, scroll, click, type, find
 *   social    — youtube, instagram, twitter, facebook, reddit, linkedin, etc.
 *   website   — generic: any URL, search on any site, interact with any page
 *   system    — window, minimize, maximize, fullscreen, notifications, clipboard
 *   vision    — screenshot, read screen, find element, click by description
 *   device    — phone, camera, bluetooth, wifi, battery
 *   file      — read, write, list, search files
 *   process   — list, kill, monitor processes
 *
 * The Planner outputs actions from this registry.
 * The Executor calls them through the agent loop.
 * The Observer feeds visual context for vision-based actions.
 */

/* ──────────────── Media Controls ──────────────────────────── */

export const MEDIA = {
  play: {
    name: 'Play',
    description: 'Play/resume current media',
    aliases: ['play', 'resume', 'continue playing', 'start playing', 'play cheyyu', 'aagu ledu play cheyyu'],
    voicePatterns: [
      /(?:play|resume|continue)\s*(?:the\s*)?(?:song|music|video|track|podcast)?/i,
      /play\s*cheyyu/i,
      /play\s*start/i,
    ],
    execute: 'media_play',
  },
  pause: {
    name: 'Pause',
    description: 'Pause current media',
    aliases: ['pause', 'pause cheyyu', 'aagu', 'hold', 'stop playing'],
    voicePatterns: [
      /(?:pause|hold|stop)\s*(?:the\s*)?(?:song|music|video|track|podcast)?/i,
      /pause\s*cheyyu/i,
      /aagu/i,
    ],
    execute: 'media_pause',
  },
  skip: {
    name: 'Skip',
    description: 'Skip forward (10s in video, next in playlist)',
    aliases: ['skip', 'skip forward', 'forward', 'munduku', 'skip cheyyu'],
    voicePatterns: [
      /skip\s*(?:forward)?/i,
      /forward/i,
      /munduku/i,
      /skip\s*cheyyu/i,
    ],
    execute: 'media_skip',
  },
  next: {
    name: 'Next',
    description: 'Next track/video/song',
    aliases: ['next', 'next song', 'next video', 'tarvata', 'next track', 'taruvaata'],
    voicePatterns: [
      /next\s*(?:song|video|track|episode)?/i,
      /tarvata/i,
      /taruvata/i,
      /next\s*cheyyu/i,
    ],
    execute: 'media_next',
  },
  previous: {
    name: 'Previous',
    description: 'Previous track/video/song',
    aliases: ['previous', 'prev', 'previous song', 'previous video', 'mundu', 'back'],
    voicePatterns: [
      /prev(?:ious)?\s*(?:song|video|track)?/i,
      /mundu\s*(?:song|video)?/i,
      /previous\s*cheyyu/i,
    ],
    execute: 'media_previous',
  },
  mute: {
    name: 'Mute',
    description: 'Mute audio',
    aliases: ['mute', 'mute cheyyu', 'sound off', 'silent', 'niraasa'],
    voicePatterns: [
      /mute/i,
      /sound\s*off/i,
      /silent/i,
      /mute\s*cheyyu/i,
    ],
    execute: 'media_mute',
  },
  unmute: {
    name: 'Unmute',
    description: 'Unmute audio',
    aliases: ['unmute', 'sound on', 'unmute cheyyu', 'sound on cheyyu'],
    voicePatterns: [
      /unmute/i,
      /sound\s*on/i,
      /unmute\s*cheyyu/i,
    ],
    execute: 'media_unmute',
  },
  volumeUp: {
    name: 'Volume Up',
    description: 'Increase volume',
    aliases: ['volume up', 'louder', 'increase volume', 'sound up', 'ekkuva'],
    voicePatterns: [
      /volume\s*up/i,
      /louder/i,
      /increase\s*(?:the\s*)?volume/i,
      /ekkuva/i,
    ],
    execute: 'media_volume_up',
  },
  volumeDown: {
    name: 'Volume Down',
    description: 'Decrease volume',
    aliases: ['volume down', 'quieter', 'decrease volume', 'sound down', 'takkuva'],
    voicePatterns: [
      /volume\s*down/i,
      /quieter/i,
      /decrease\s*(?:the\s*)?volume/i,
      /takkuva/i,
    ],
    execute: 'media_volume_down',
  },
  seekForward: {
    name: 'Seek Forward',
    description: 'Seek forward in media (seconds)',
    aliases: ['seek forward', 'forward 10', 'skip ahead', 'fast forward'],
    voicePatterns: [
      /(?:seek|skip|fast)\s*forward\s*(\d+)?/i,
      /forward\s*(\d+)\s*(?:sec|second|min|minute)?/i,
    ],
    execute: 'media_seek_forward',
    params: ['seconds'],
  },
  seekBackward: {
    name: 'Seek Backward',
    description: 'Seek backward in media (seconds)',
    aliases: ['seek backward', 'rewind', 'go back'],
    voicePatterns: [
      /(?:seek|go)\s*back(?:ward)?\s*(\d+)?/i,
      /rewind\s*(\d+)?/i,
    ],
    execute: 'media_seek_backward',
    params: ['seconds'],
  },
  shuffle: {
    name: 'Shuffle',
    description: 'Toggle shuffle mode',
    aliases: ['shuffle', 'shuffle on', 'shuffle off', 'random play'],
    voicePatterns: [/shuffle/i, /random\s*(?:play|mode)?/i],
    execute: 'media_shuffle',
  },
  repeat: {
    name: 'Repeat',
    description: 'Toggle repeat mode',
    aliases: ['repeat', 'loop', 'repeat on', 'repeat off'],
    voicePatterns: [/repeat/i, /loop/i, /repeat\s*(?:this|song|track)?/i],
    execute: 'media_repeat',
  },
  like: {
    name: 'Like',
    description: 'Like/upvote current content',
    aliases: ['like', 'like cheyyu', 'upvote', 'heart'],
    voicePatterns: [/like\s*(?:this|it|the\s*(?:song|video|post))?/i, /upvote/i, /like\s*cheyyu/i],
    execute: 'media_like',
  },
  dislike: {
    name: 'Dislike',
    description: 'Dislike/downvote current content',
    aliases: ['dislike', 'dislike cheyyu', 'downvote'],
    voicePatterns: [/dislike\s*(?:this|it)?/i, /downvote/i],
    execute: 'media_dislike',
  },
}

/* ──────────────── Browser Controls ──────────────────────────── */

export const BROWSER = {
  open: {
    name: 'Open',
    description: 'Open a URL or website',
    aliases: ['open', 'go to', 'navigate to', 'visit', 'open cheyyu'],
    voicePatterns: [
      /open\s+(.+)/i,
      /go\s*to\s+(.+)/i,
      /navigate\s*to\s+(.+)/i,
      /visit\s+(.+)/i,
      /(.+)\s*open\s*cheyyu/i,
    ],
    execute: 'browser_open',
    params: ['url'],
  },
  close: {
    name: 'Close',
    description: 'Close current tab or window',
    aliases: ['close', 'close tab', 'close window', 'close cheyyu', 'bandh cheyyu'],
    voicePatterns: [
      /close\s*(?:the\s*)?(?:tab|window|page|browser)?/i,
      /close\s*cheyyu/i,
      /bandh\s*cheyyu/i,
    ],
    execute: 'browser_close',
  },
  newTab: {
    name: 'New Tab',
    description: 'Open a new browser tab',
    aliases: ['new tab', 'open tab', 'kotha tab'],
    voicePatterns: [
      /(?:open|new|create)\s*(?:a\s*)?(?:new\s*)?tab/i,
      /kotha\s*tab/i,
    ],
    execute: 'browser_new_tab',
  },
  switchTab: {
    name: 'Switch Tab',
    description: 'Switch to another tab (by number or title)',
    aliases: ['switch tab', 'go to tab', 'tab switch'],
    voicePatterns: [
      /switch\s*(?:to\s*)?(?:the\s*)?tab\s*(\d+)?/i,
      /go\s*to\s*tab\s*(\d+)/i,
    ],
    execute: 'browser_switch_tab',
    params: ['tabIndex'],
  },
  scrollDown: {
    name: 'Scroll Down',
    description: 'Scroll page down',
    aliases: ['scroll down', 'scroll', 'down', 'kindha', 'scroll cheyyu'],
    voicePatterns: [
      /scroll\s*(?:down)?/i,
      /down/i,
      /kindha/i,
      /scroll\s*cheyyu/i,
    ],
    execute: 'browser_scroll_down',
  },
  scrollUp: {
    name: 'Scroll Up',
    description: 'Scroll page up',
    aliases: ['scroll up', 'up', 'meeda'],
    voicePatterns: [
      /scroll\s*up/i,
      /up/i,
      /meeda/i,
    ],
    execute: 'browser_scroll_up',
  },
  click: {
    name: 'Click',
    description: 'Click an element (by text, position, or description)',
    aliases: ['click', 'tap', 'press', 'click cheyyu', 'press cheyyu'],
    voicePatterns: [
      /click\s*(?:on\s*)?(?:the\s*)?(.+)/i,
      /tap\s*(?:on\s*)?(?:the\s*)?(.+)/i,
      /press\s*(?:the\s*)?(.+)/i,
      /(.+)\s*click\s*cheyyu/i,
    ],
    execute: 'browser_click',
    params: ['target'],
  },
  type: {
    name: 'Type',
    description: 'Type text into a field',
    aliases: ['type', 'write', 'enter', 'type cheyyu', 'rayu'],
    voicePatterns: [
      /type\s+(.+)/i,
      /(?:write|enter)\s+(.+)/i,
      /(.+)\s*type\s*cheyyu/i,
      /(.+)\s*rayu/i,
    ],
    execute: 'browser_type',
    params: ['text'],
  },
  search: {
    name: 'Search',
    description: 'Search on current site or Google',
    aliases: ['search', 'search for', 'find', 'google', 'search cheyyu', 'vetuku'],
    voicePatterns: [
      /search\s*(?:for\s*)?(.+)/i,
      /google\s+(.+)/i,
      /find\s+(.+)/i,
      /(.+)\s*search\s*cheyyu/i,
      /(.+)\s*vetuku/i,
    ],
    execute: 'browser_search',
    params: ['query'],
  },
  goBack: {
    name: 'Go Back',
    description: 'Navigate back',
    aliases: ['back', 'go back', 'venakki', 'previous page'],
    voicePatterns: [/go\s*back/i, /back/i, /venakki/i],
    execute: 'browser_back',
  },
  goForward: {
    name: 'Go Forward',
    description: 'Navigate forward',
    aliases: ['forward', 'go forward', 'munduku'],
    voicePatterns: [/go\s*forward/i, /forward/i],
    execute: 'browser_forward',
  },
  refresh: {
    name: 'Refresh',
    description: 'Refresh the page',
    aliases: ['refresh', 'reload', 'refresh cheyyu'],
    voicePatterns: [/refresh/i, /reload/i, /refresh\s*cheyyu/i],
    execute: 'browser_refresh',
  },
  fullScreen: {
    name: 'Fullscreen',
    description: 'Toggle fullscreen',
    aliases: ['fullscreen', 'full screen', 'exit fullscreen'],
    voicePatterns: [/full\s*screen/i, /fullscreen/i],
    execute: 'browser_fullscreen',
  },
  screenshot: {
    name: 'Screenshot',
    description: 'Take a screenshot of current page',
    aliases: ['screenshot', 'screen capture', 'take screenshot', 'photo teesu'],
    voicePatterns: [
      /screenshot/i,
      /screen\s*(?:shot|capture)/i,
      /take\s*(?:a\s*)?screenshot/i,
      /photo\s*teesu/i,
    ],
    execute: 'browser_screenshot',
  },
  readPage: {
    name: 'Read Page',
    description: 'Read/summarize the current page content',
    aliases: ['read', 'read page', 'read this', 'summarize', 'chaduvu', 'cheppu'],
    voicePatterns: [
      /read\s*(?:this|the\s*)?(?:page|article|content|screen)/i,
      /summarize\s*(?:this)?/i,
      /what('s|\s+is)\s+(?:on|showing)/i,
      /chaduvu/i,
      /cheppu/i,
    ],
    execute: 'browser_read',
  },
  download: {
    name: 'Download',
    description: 'Download current page or link',
    aliases: ['download', 'download cheyyu'],
    voicePatterns: [/download\s*(?:this)?/i, /download\s*cheyyu/i],
    execute: 'browser_download',
  },
  bookmark: {
    name: 'Bookmark',
    description: 'Bookmark current page',
    aliases: ['bookmark', 'save bookmark', 'bookmark cheyyu'],
    voicePatterns: [/bookmark\s*(?:this)?/i, /save\s*(?:this\s*)?(?:page\s*)?bookmark/i],
    execute: 'browser_bookmark',
  },
}

/* ──────────────── Social Media ──────────────────────────── */

export const SOCIAL = {
  // ── YouTube ──
  youtube: {
    name: 'YouTube',
    description: 'Open YouTube',
    url: 'https://youtube.com',
    aliases: ['youtube', 'youtube open', 'youtube cheyyu'],
    voicePatterns: [/youtube/i, /youtube\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'youtube',
  },
  youtubeSearch: {
    name: 'YouTube Search',
    description: 'Search YouTube for videos',
    aliases: ['youtube search', 'youtube lo search'],
    voicePatterns: [
      /youtube\s*(?:lo|meeda)?\s*search\s*(?:for\s*)?(.+)/i,
      /youtube\s*(?:lo)?\s*(.+)\s*search/i,
      /(.+)\s*youtube\s*(?:lo)?\s*(?:search|vetuku)/i,
    ],
    execute: 'social_search',
    platform: 'youtube',
    params: ['query'],
  },
  youtubePlay: {
    name: 'YouTube Play',
    description: 'Play a video on YouTube',
    aliases: ['play on youtube', 'youtube lo play'],
    voicePatterns: [
      /youtube\s*(?:lo)?\s*(.+)\s*(?:play|pettu|vedio)/i,
      /(.+)\s*youtube\s*(?:lo)?\s*(?:play|pettu)/i,
      /play\s+(.+)\s*(?:on|in)\s*youtube/i,
    ],
    execute: 'social_play',
    platform: 'youtube',
    params: ['query'],
  },
  youtubeSubscribe: {
    name: 'Subscribe',
    description: 'Subscribe to current YouTube channel',
    aliases: ['subscribe', 'subscribe cheyyu'],
    voicePatterns: [/subscribe/i, /subscribe\s*cheyyu/i],
    execute: 'social_action',
    platform: 'youtube',
    action: 'subscribe',
  },

  // ── Instagram ──
  instagram: {
    name: 'Instagram',
    description: 'Open Instagram',
    url: 'https://instagram.com',
    aliases: ['instagram', 'insta', 'instagram open'],
    voicePatterns: [/instagram/i, /insta(?:gram)?\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'instagram',
  },
  instagramSearch: {
    name: 'Instagram Search',
    description: 'Search Instagram',
    aliases: ['instagram search', 'insta search'],
    voicePatterns: [
      /instagram\s*(?:lo)?\s*search\s*(?:for\s*)?(.+)/i,
      /insta\s*(?:lo)?\s*search\s*(?:for\s*)?(.+)/i,
    ],
    execute: 'social_search',
    platform: 'instagram',
    params: ['query'],
  },
  instagramReels: {
    name: 'Instagram Reels',
    description: 'Open Instagram Reels',
    aliases: ['reels', 'instagram reels', 'insta reels'],
    voicePatterns: [/reels?/i, /instagram\s*reels?/i],
    execute: 'social_open',
    platform: 'instagram',
    path: '/reels',
  },
  instagramStory: {
    name: 'Instagram Story',
    description: 'View Instagram stories',
    aliases: ['stories', 'instagram stories', 'insta stories'],
    voicePatterns: [/stor(?:y|ies)/i, /instagram\s*stor(?:y|ies)/i],
    execute: 'social_open',
    platform: 'instagram',
    path: '/stories',
  },

  // ── Twitter/X ──
  twitter: {
    name: 'Twitter/X',
    description: 'Open Twitter/X',
    url: 'https://x.com',
    aliases: ['twitter', 'x', 'twitter open', 'x open'],
    voicePatterns: [/(?:twitter|x(?:\.com)?)\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'twitter',
  },
  twitterSearch: {
    name: 'Twitter Search',
    description: 'Search Twitter/X',
    aliases: ['twitter search', 'x search'],
    voicePatterns: [
      /(?:twitter|x)\s*(?:lo)?\s*search\s*(?:for\s*)?(.+)/i,
    ],
    execute: 'social_search',
    platform: 'twitter',
    params: ['query'],
  },
  twitterPost: {
    name: 'Tweet',
    description: 'Post a tweet',
    aliases: ['tweet', 'post tweet', 'tweet cheyyu'],
    voicePatterns: [
      /tweet\s+(.+)/i,
      /post\s*(?:a\s*)?tweet\s*:?\s*(.+)/i,
      /(.+)\s*tweet\s*cheyyu/i,
    ],
    execute: 'social_post',
    platform: 'twitter',
    params: ['text'],
  },

  // ── Facebook ──
  facebook: {
    name: 'Facebook',
    description: 'Open Facebook',
    url: 'https://facebook.com',
    aliases: ['facebook', 'fb', 'facebook open'],
    voicePatterns: [/(?:facebook|fb)\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'facebook',
  },

  // ── Reddit ──
  reddit: {
    name: 'Reddit',
    description: 'Open Reddit',
    url: 'https://reddit.com',
    aliases: ['reddit', 'reddit open'],
    voicePatterns: [/reddit\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'reddit',
  },
  redditSearch: {
    name: 'Reddit Search',
    description: 'Search Reddit',
    aliases: ['reddit search'],
    voicePatterns: [/reddit\s*(?:lo)?\s*search\s*(?:for\s*)?(.+)/i],
    execute: 'social_search',
    platform: 'reddit',
    params: ['query'],
  },

  // ── LinkedIn ──
  linkedin: {
    name: 'LinkedIn',
    description: 'Open LinkedIn',
    url: 'https://linkedin.com',
    aliases: ['linkedin', 'linkedin open'],
    voicePatterns: [/linkedin\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'linkedin',
  },

  // ── WhatsApp ──
  whatsapp: {
    name: 'WhatsApp',
    description: 'Open WhatsApp Web',
    url: 'https://web.whatsapp.com',
    aliases: ['whatsapp', 'whatsapp open', 'whatsapp web'],
    voicePatterns: [/whatsapp\s*(?:web|open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'whatsapp',
  },
  whatsappMessage: {
    name: 'WhatsApp Message',
    description: 'Send a WhatsApp message',
    aliases: ['whatsapp message', 'send whatsapp'],
    voicePatterns: [
      /whatsapp\s*(?:lo)?\s*(.+)\s*ki\s*(.+)\s*(?:send|pampu)/i,
      /send\s*(.+)\s*(?:on|via)\s*whatsapp/i,
    ],
    execute: 'social_message',
    platform: 'whatsapp',
    params: ['contact', 'message'],
  },

  // ── Telegram ──
  telegram: {
    name: 'Telegram',
    description: 'Open Telegram Web',
    url: 'https://web.telegram.org',
    aliases: ['telegram', 'telegram open', 'telegram web'],
    voicePatterns: [/telegram\s*(?:web|open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'telegram',
  },

  // ── Spotify ──
  spotify: {
    name: 'Spotify',
    description: 'Open Spotify Web',
    url: 'https://open.spotify.com',
    aliases: ['spotify', 'spotify open', 'spotify web'],
    voicePatterns: [/spotify\s*(?:web|open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'spotify',
  },
  spotifyPlay: {
    name: 'Spotify Play',
    description: 'Play music on Spotify',
    aliases: ['spotify play', 'play on spotify'],
    voicePatterns: [
      /spotify\s*(?:lo)?\s*(.+)\s*(?:play|pettu|vinu)/i,
      /play\s+(.+)\s*(?:on|in)\s*spotify/i,
    ],
    execute: 'social_play',
    platform: 'spotify',
    params: ['query'],
  },

  // ── Gmail ──
  gmail: {
    name: 'Gmail',
    description: 'Open Gmail',
    url: 'https://mail.google.com',
    aliases: ['gmail', 'email', 'gmail open', 'mail open'],
    voicePatterns: [/(?:gmail|email|mail)\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'gmail',
  },

  // ── GitHub ──
  github: {
    name: 'GitHub',
    description: 'Open GitHub',
    url: 'https://github.com',
    aliases: ['github', 'github open'],
    voicePatterns: [/github\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'github',
  },

  // ── Google Maps ──
  maps: {
    name: 'Google Maps',
    description: 'Open Google Maps',
    url: 'https://maps.google.com',
    aliases: ['maps', 'google maps', 'maps open', 'directions'],
    voicePatterns: [/(?:google\s*)?maps?\s*(?:open|cheyyu)?/i, /directions?\s*to\s+(.+)/i],
    execute: 'social_open',
    platform: 'maps',
  },

  // ── Netflix ──
  netflix: {
    name: 'Netflix',
    description: 'Open Netflix',
    url: 'https://netflix.com',
    aliases: ['netflix', 'netflix open'],
    voicePatterns: [/netflix\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'netflix',
  },

  // ── Amazon ──
  amazon: {
    name: 'Amazon',
    description: 'Open Amazon',
    url: 'https://amazon.com',
    aliases: ['amazon', 'amazon open', 'shopping'],
    voicePatterns: [/amazon\s*(?:open|cheyyu)?/i, /shopping\s*(?:open)?/i],
    execute: 'social_open',
    platform: 'amazon',
  },

  // ── Flipkart ──
  flipkart: {
    name: 'Flipkart',
    description: 'Open Flipkart',
    url: 'https://flipkart.com',
    aliases: ['flipkart', 'flipkart open'],
    voicePatterns: [/flipkart\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'flipkart',
  },

  // ── Google Drive ──
  drive: {
    name: 'Google Drive',
    description: 'Open Google Drive',
    url: 'https://drive.google.com',
    aliases: ['drive', 'google drive', 'drive open'],
    voicePatterns: [/(?:google\s*)?drive\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'drive',
  },

  // ── ChatGPT ──
  chatgpt: {
    name: 'ChatGPT',
    description: 'Open ChatGPT',
    url: 'https://chat.openai.com',
    aliases: ['chatgpt', 'gpt', 'chatgpt open'],
    voicePatterns: [/(?:chat\s*)?gpt\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'chatgpt',
  },

  // ── Discord ──
  discord: {
    name: 'Discord',
    description: 'Open Discord Web',
    url: 'https://discord.com/app',
    aliases: ['discord', 'discord open'],
    voicePatterns: [/discord\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'discord',
  },

  // ── Pinterest ──
  pinterest: {
    name: 'Pinterest',
    description: 'Open Pinterest',
    url: 'https://pinterest.com',
    aliases: ['pinterest', 'pinterest open'],
    voicePatterns: [/pinterest\s*(?:open|cheyyu)?/i],
    execute: 'social_open',
    platform: 'pinterest',
  },
}

/* ──────────────── System / Window Controls ──────────────────────────── */

export const SYSTEM = {
  minimize: {
    name: 'Minimize',
    description: 'Minimize current window',
    aliases: ['minimize', 'minimize cheyyu', 'hide'],
    voicePatterns: [/minimize/i, /hide\s*(?:the\s*)?(?:window)?/i],
    execute: 'system_minimize',
  },
  maximize: {
    name: 'Maximize',
    description: 'Maximize current window',
    aliases: ['maximize', 'maximize cheyyu', 'full window'],
    voicePatterns: [/maximize/i, /full\s*window/i],
    execute: 'system_maximize',
  },
  closeWindow: {
    name: 'Close Window',
    description: 'Close current window',
    aliases: ['close window', 'close app', 'close cheyyu', 'bandh'],
    voicePatterns: [
      /close\s*(?:the\s*)?(?:window|app|application)/i,
      /close\s*cheyyu/i,
      /bandh\s*cheyyu/i,
    ],
    execute: 'system_close_window',
  },
  switchWindow: {
    name: 'Switch Window',
    description: 'Switch to another window',
    aliases: ['switch window', 'switch app', 'alt tab'],
    voicePatterns: [
      /switch\s*(?:to\s*)?(?:the\s*)?(?:window|app)\s*(.+)/i,
      /alt\s*tab/i,
    ],
    execute: 'system_switch_window',
    params: ['appName'],
  },
  notifications: {
    name: 'Notifications',
    description: 'Show notifications',
    aliases: ['notifications', 'show notifications', 'notificatons cheyyu'],
    voicePatterns: [/notifications?/i, /show\s*notifications?/i],
    execute: 'system_notifications',
  },
  clipboard: {
    name: 'Clipboard',
    description: 'Copy/paste clipboard',
    aliases: ['copy', 'paste', 'clipboard'],
    voicePatterns: [/(?:copy|paste)\s*(?:this|to\s*clipboard)?/i],
    execute: 'system_clipboard',
    params: ['action'],
  },
  volume: {
    name: 'System Volume',
    description: 'Set system volume (0-100)',
    aliases: ['set volume', 'volume to'],
    voicePatterns: [
      /(?:set\s*)?volume\s*(?:to\s*)?(\d+)/i,
      /(\d+)\s*(?:percent)?\s*volume/i,
    ],
    execute: 'system_volume',
    params: ['level'],
  },
  brightness: {
    name: 'Brightness',
    description: 'Set screen brightness',
    aliases: ['brightness', 'set brightness'],
    voicePatterns: [
      /(?:set\s*)?brightness\s*(?:to\s*)?(\d+)/i,
      /(brighter|darker)/i,
    ],
    execute: 'system_brightness',
    params: ['level'],
  },
  wifi: {
    name: 'WiFi',
    description: 'Toggle WiFi on/off',
    aliases: ['wifi on', 'wifi off', 'wifi'],
    voicePatterns: [/wifi\s*(on|off|toggle)?/i],
    execute: 'system_wifi',
    params: ['state'],
  },
  bluetooth: {
    name: 'Bluetooth',
    description: 'Toggle Bluetooth on/off',
    aliases: ['bluetooth on', 'bluetooth off'],
    voicePatterns: [/bluetooth\s*(on|off|toggle)?/i],
    execute: 'system_bluetooth',
    params: ['state'],
  },
  battery: {
    name: 'Battery',
    description: 'Check battery status',
    aliases: ['battery', 'battery level', 'battery status'],
    voicePatterns: [/battery\s*(?:level|status|percent)?/i],
    execute: 'system_battery',
  },
  lock: {
    name: 'Lock Screen',
    description: 'Lock the screen',
    aliases: ['lock', 'lock screen', 'lock cheyyu'],
    voicePatterns: [/lock\s*(?:the\s*)?(?:screen|computer|pc)?/i],
    execute: 'system_lock',
  },
  sleep: {
    name: 'Sleep',
    description: 'Put system to sleep',
    aliases: ['sleep', 'sleep mode'],
    voicePatterns: [/sleep\s*(?:mode)?/i],
    execute: 'system_sleep',
  },
}

/* ──────────────── Generic Website Interaction ──────────────────────────── */

export const WEBSITE = {
  openSite: {
    name: 'Open Website',
    description: 'Open any website by URL or name',
    aliases: ['open site', 'go to site'],
    voicePatterns: [
      /open\s+(https?:\/\/.+)/i,
      /go\s*to\s+(https?:\/\/.+)/i,
    ],
    execute: 'website_open',
    params: ['url'],
  },
  findOnPage: {
    name: 'Find on Page',
    description: 'Find text or element on current page',
    aliases: ['find on page', 'search on page', 'find'],
    voicePatterns: [
      /find\s+(.+)\s*(?:on|in)\s*(?:the\s*)?(?:page|screen|website)/i,
      /(?:where|evaru)\s*(?:is|unnadi)\s+(.+)/i,
    ],
    execute: 'website_find',
    params: ['query'],
  },
  clickElement: {
    name: 'Click Element',
    description: 'Click any element by description (vision-based)',
    aliases: ['click element', 'press button', 'tap on'],
    voicePatterns: [
      /click\s*(?:on\s*)?(?:the\s*)?(.+)/i,
      /press\s*(?:the\s*)?(.+)\s*button/i,
      /tap\s*(?:on\s*)?(?:the\s*)?(.+)/i,
      /(.+)\s*click\s*cheyyu/i,
    ],
    execute: 'website_click_element',
    params: ['description'],
  },
  fillField: {
    name: 'Fill Field',
    description: 'Fill a form field (vision-based)',
    aliases: ['fill field', 'type in', 'enter in'],
    voicePatterns: [
      /(?:fill|type|enter)\s+(.+)\s*(?:in|into)\s*(?:the\s*)?(.+)/i,
      /(.+)\s*(?:lo|in)\s*(.+)\s*(?:type|enter|rayu)/i,
    ],
    execute: 'website_fill_field',
    params: ['value', 'field'],
  },
  selectOption: {
    name: 'Select Option',
    description: 'Select an option from a dropdown',
    aliases: ['select', 'choose', 'select option'],
    voicePatterns: [
      /select\s+(.+)/i,
      /choose\s+(.+)/i,
      /(.+)\s*select\s*cheyyu/i,
    ],
    execute: 'website_select',
    params: ['option'],
  },
  submitForm: {
    name: 'Submit Form',
    description: 'Submit a form',
    aliases: ['submit', 'submit form', 'send form'],
    voicePatterns: [/submit\s*(?:the\s*)?(?:form)?/i, /send\s*(?:the\s*)?(?:form)?/i],
    execute: 'website_submit',
  },
  waitForElement: {
    name: 'Wait for Element',
    description: 'Wait for an element to appear',
    aliases: ['wait for', 'wait until'],
    voicePatterns: [/wait\s*for\s+(.+)/i, /wait\s*until\s+(.+)/i],
    execute: 'website_wait',
    params: ['element'],
  },
}

/* ──────────────── Vision-based Interaction ──────────────────────────── */

export const VISION = {
  lookAt: {
    name: 'Look At',
    description: 'Look at screen/camera and describe what you see',
    aliases: ['look at', 'what do you see', 'describe', 'chuudu', 'emi kanipistondi'],
    voicePatterns: [
      /(?:look\s*at|what\s*(?:do\s*you|does\s*it)\s*see)/i,
      /describe\s*(?:this|what\s*you\s*see)/i,
      /what('s|\s+is)\s+(?:on|showing\s*on)\s*(?:the\s*)?(?:screen|page)/i,
      /chuudu/i,
      /emi\s*kanipistondi/i,
    ],
    execute: 'vision_look',
  },
  findButton: {
    name: 'Find Button',
    description: 'Find a button on screen by description',
    aliases: ['find button', 'where is button', 'button ekkada'],
    voicePatterns: [
      /(?:find|where\s*is)\s*(?:the\s*)?(.+)\s*button/i,
      /(.+)\s*button\s*ekkada/i,
    ],
    execute: 'vision_find_button',
    params: ['description'],
  },
  readText: {
    name: 'Read Text',
    description: 'Read text from screen/camera',
    aliases: ['read text', 'read this', 'what does it say', 'emundi'],
    voicePatterns: [
      /read\s*(?:the\s*)?text/i,
      /what\s*does\s*(?:it|this)\s*say/i,
      /emundi/i,
    ],
    execute: 'vision_read_text',
  },
  watchScreen: {
    name: 'Watch Screen',
    description: 'Continuously monitor screen for changes',
    aliases: ['watch screen', 'monitor', 'watch'],
    voicePatterns: [
      /watch\s*(?:the\s*)?(?:screen|page)/i,
      /monitor\s*(?:the\s*)?(?:screen|page)/i,
    ],
    execute: 'vision_watch',
  },
  takePhoto: {
    name: 'Take Photo',
    description: 'Take a photo with camera',
    aliases: ['take photo', 'camera', 'photo teesu', 'camera on'],
    voicePatterns: [
      /take\s*(?:a\s*)?photo/i,
      /camera\s*(?:on|open)?/i,
      /photo\s*teesu/i,
    ],
    execute: 'vision_camera',
  },
}

/* ──────────────── Master registry ──────────────────────────── */

export const ALL_COMMANDS = {
  ...MEDIA,
  ...BROWSER,
  ...SOCIAL,
  ...SYSTEM,
  ...WEBSITE,
  ...VISION,
}

/**
 * Match a voice command to the best matching tool.
 *
 * Tries each category's voice patterns in order. Returns the first match
 * with captured parameters.
 */
export function matchCommand(text) {
  const normalized = String(text ?? '').trim().toLowerCase()
  if (!normalized) return null

  // Try each category
  for (const [category, commands] of Object.entries({ MEDIA, BROWSER, SOCIAL, SYSTEM, WEBSITE, VISION })) {
    for (const [key, cmd] of Object.entries(commands)) {
      for (const pattern of cmd.voicePatterns ?? []) {
        const match = normalized.match(pattern)
        if (match) {
          // Extract parameters from capture groups
          const params = {}
          if (cmd.params) {
            cmd.params.forEach((name, i) => {
              params[name] = match[i + 1]?.trim() ?? ''
            })
          }
          return {
            category,
            key,
            command: cmd,
            params,
            confidence: match[0].length / normalized.length,
          }
        }
      }
    }
  }

  // Fallback: check aliases
  for (const [category, commands] of Object.entries({ MEDIA, BROWSER, SOCIAL, SYSTEM, WEBSITE, VISION })) {
    for (const [key, cmd] of Object.entries(commands)) {
      for (const alias of cmd.aliases ?? []) {
        if (normalized.includes(alias.toLowerCase())) {
          return { category, key, command: cmd, params: {}, confidence: 0.5 }
        }
      }
    }
  }

  return null
}

/**
 * Get all available commands as a flat list for the Planner's reference.
 */
export function commandList() {
  const lines = []
  for (const [category, commands] of Object.entries({ MEDIA, BROWSER, SOCIAL, SYSTEM, WEBSITE, VISION })) {
    lines.push(`\n${category.toUpperCase()}:`)
    for (const [key, cmd] of Object.entries(commands)) {
      const aliases = (cmd.aliases ?? []).slice(0, 3).join(', ')
      lines.push(`  ${key}: ${cmd.description} (${aliases})`)
    }
  }
  return lines.join('\n')
}

export default {
  MEDIA,
  BROWSER,
  SOCIAL,
  SYSTEM,
  WEBSITE,
  VISION,
  ALL_COMMANDS,
  matchCommand,
  commandList,
}