// Site-owner settings. Never put Discord webhook URLs or other secrets here.
window.MESOSWATCH_CONFIG = {
  donationUrl: '',
  donationLabel: 'Support Mesos-Watch ↗',
  // Optional direct sponsor. Links and images must use HTTPS.
  sponsor: { title: '', url: '', imageUrl: '' },
  // Community price database. Project URL and the public "anon" key from Supabase -> Project Settings -> API.
  // The anon key is meant to be public; access is limited by supabase/migrations. Never put the service_role key here.
  // worlds: optional list of game worlds for the picker, e.g. ['Bera', 'Scania']. Leave empty for one shared board.
  prices: { supabaseUrl: 'https://nnfnlqgdzfcxtrnjpyzn.supabase.co', supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5uZm5scWdkemZjeHRybmpweXpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1NDA2MjgsImV4cCI6MjEwOTExNjYyOH0.Bax0yRL_PZYYbTjF-_DEoJDB4Iy2rntNaDKXVbHmH6E', worlds: [] },
  // Item pictures by game item id (MapleStory Classic World data from OSMS Data Explorer). See SETUP.md before changing the source.
  items: { iconBase: 'https://osmsdataexplorer.com/data/current/images/items/' }
};
