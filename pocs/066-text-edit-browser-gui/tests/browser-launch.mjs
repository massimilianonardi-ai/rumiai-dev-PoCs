// Hosted Chromium is the default. The reference Ubuntu VM uses its own
// installed Chromium; headful with a GUI, otherwise native headless.
import {chromium} from 'playwright';

export async function launchTestChromium()
{
  const reference=process.env.RUMIAI_G07_REFERENCE==='1';
  const headless=process.env.RUMIAI_G07_HEADLESS==='1';
  if(reference && !process.env.RUMIAI_G07_CHROMIUM)
  {
    throw new Error('G07 native Chromium executable is required');
  }
  return chromium.launch
  (
    {
      headless:reference?headless:true,
      ...(reference?{executablePath:process.env.RUMIAI_G07_CHROMIUM}:{}),
      args:reference?[]:['--no-sandbox']
    }
  );
}
