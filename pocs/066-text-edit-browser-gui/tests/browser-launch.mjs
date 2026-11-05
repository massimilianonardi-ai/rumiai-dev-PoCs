// Real hosted Chromium is the default. The physical launcher alone opts
// into a native headful system browser after Ubuntu/ARM64 host preflight.
import {chromium} from 'playwright';

export async function launchTestChromium()
{
  const physical=process.env.RUMIAI_G07_PHYSICAL==='1';
  if(physical && !process.env.RUMIAI_G07_CHROMIUM)
  {
    throw new Error('G07 native Chromium executable is required');
  }
  return chromium.launch
  (
    {
      headless:!physical,
      ...(physical?{executablePath:process.env.RUMIAI_G07_CHROMIUM}:{}),
      args:physical?[]:['--no-sandbox']
    }
  );
}
