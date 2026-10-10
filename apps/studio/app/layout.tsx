import 'flexlayout-react/style/light.css';
import type {ReactNode} from 'react';
import './style.css';
export const metadata={metadataBase:new URL('https://anascummis.com'),title:'Anascummis',description:'Talk to your local AI. Create websites, edit documents and make videos through one conversational orb.',alternates:{canonical:'/'},openGraph:{type:'website',url:'https://anascummis.com/',siteName:'Anascummis',title:'Anascummis — your local AI',description:'One conversational orb for your work. Websites, documents and video, on your computer.',images:[{url:'/orb-embed.jpg',width:1200,height:630,alt:'A cyan holographic Anascummis orb'}]},twitter:{card:'summary_large_image',title:'Anascummis — your local AI',description:'One conversational orb for your work, on your computer.',images:['/orb-embed.jpg']}};
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>;}
