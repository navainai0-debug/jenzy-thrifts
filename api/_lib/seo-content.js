// Text for the Google landing pages: /brand/<name> and /city/<name>.
// A brand page is listed in the sitemap when the brand has shoes in the
// shop (or a written intro below). Add more brands here any time.
export const BRAND_INFO = {
    nike: {
        name: 'Nike', aliases: ['nike', 'nike sb', 'nike acg'],
        intro: 'Nike is the most loved sneaker brand in Pakistan — from the all-white Air Force 1 to Dunks, Air Max and running shoes. Brand-new Nikes cost a lot here and many models never reach local shops, so thrifted originals are the smart way to get the real thing.',
        points: ['Air Force 1, Dunk, Air Max, Blazer, Cortez and Nike running shoes', 'Checked for authenticity: size tag, style code, stitching and shape', 'Real photos of the exact pair you get']
    },
    jordan: {
        name: 'Jordan', aliases: ['jordan', 'air jordan', 'nike jordan', 'jordan brand'],
        intro: "Air Jordans are the holy grail for sneakerheads. Jordan 1s, 4s and 11s are hard to find in Pakistan and fakes are everywhere — that's why every thrifted Jordan we list is checked before it goes up.",
        points: ['Jordan 1 High, Mid and Low, Jordan 3, 4, 11 and more', 'Authenticity checked — no "master copies"', 'Cash on delivery, so you see the pair before you pay']
    },
    adidas: {
        name: 'Adidas', aliases: ['adidas', 'adidas originals'],
        intro: 'Adidas makes some of the most comfortable everyday sneakers — Ultraboost, NMD, Stan Smith, Superstar, Samba and Gazelle. Thrifted Adidas give you that famous Boost comfort and classic three-stripe style at a fraction of the retail price.',
        points: ['Ultraboost, NMD, Stan Smith, Superstar, Samba, Gazelle, Forum', 'Usually a roomier fit than Nike', 'Honest condition grades: Excellent, Good or Fair']
    },
    'new-balance': {
        name: 'New Balance', aliases: ['new balance', 'newbalance', 'nb'],
        intro: 'New Balance is loved for comfort and its clean "dad shoe" look — the 550, 574, 990 and 2002R are everywhere right now. They usually fit true to size and many come in wide widths.',
        points: ['550, 574, 530, 990, 2002R, 9060 and running models', 'Great for wide feet', 'Every pair cleaned and photographed']
    },
    puma: {
        name: 'Puma', aliases: ['puma'],
        intro: 'Puma mixes sport and street style — Suede classics, RS-X, Palermo and comfortable running shoes. Thrifted Pumas are an easy way to get a branded pair on a budget.',
        points: ['Suede, RS-X, Palermo, Speedcat and running shoes', 'Light and comfortable for daily wear', 'Cash on delivery across Pakistan']
    },
    converse: {
        name: 'Converse', aliases: ['converse'],
        intro: 'The Converse Chuck Taylor All Star and Chuck 70 are timeless. They go with jeans, chinos and even shalwar kameez. Tip: Converse usually run large, so most people go half a size down.',
        points: ['Chuck Taylor All Star, Chuck 70, One Star and Run Star', 'Runs about half a size big', 'Low and high tops']
    },
    vans: {
        name: 'Vans', aliases: ['vans'],
        intro: 'Vans are skate classics — the Old Skool, Sk8-Hi, Authentic and Slip-On. Tough canvas and suede, waffle soles and a fit that is usually true to size.',
        points: ['Old Skool, Sk8-Hi, Authentic, Era and Slip-On', 'Usually true to size', 'Durable for daily wear']
    },
    reebok: {
        name: 'Reebok', aliases: ['reebok'],
        intro: 'Reebok Club C and Classic Leather are clean retro sneakers that never go out of style, and Reebok Nano trainers are favourites in the gym.',
        points: ['Club C, Classic Leather, Workout and Nano', 'Comfortable retro style', 'Checked and cleaned before shipping']
    },
    asics: {
        name: 'Asics', aliases: ['asics', 'asics tiger'],
        intro: 'Asics make some of the best running shoes in the world — Gel-Kayano, Gel-Nimbus and Gel-Lyte — plus retro lifestyle models that are very popular right now.',
        points: ['Gel-Kayano, Gel-Nimbus, Gel-1130, Gel-Lyte III', 'Excellent cushioning for running and walking', 'Real photos of every pair']
    },
    'onitsuka-tiger': {
        name: 'Onitsuka Tiger', aliases: ['onitsuka tiger', 'onitsuka'],
        intro: 'Onitsuka Tiger is the Japanese heritage brand behind the slim, stylish Mexico 66. Brand-new pairs are pricey — thrifted is the way to go.',
        points: ['Mexico 66 and other heritage styles', 'Slim fit — check the cm size', 'Authenticity checked']
    },
    skechers: {
        name: 'Skechers', aliases: ['skechers'],
        intro: 'Skechers are all about comfort — memory-foam insoles and light, flexible soles that are perfect for long days on your feet.',
        points: ['Go Walk, Max Cushioning, D\'Lites and more', 'Very comfortable for daily use', 'Great value thrifted']
    },
    'under-armour': {
        name: 'Under Armour', aliases: ['under armour', 'underarmour', 'ua'],
        intro: 'Under Armour makes performance trainers and running shoes like the HOVR and Charged series, built for training and the gym.',
        points: ['HOVR, Charged and Curry basketball shoes', 'Built for sport and training', 'Cash on delivery']
    },
    yeezy: {
        name: 'Yeezy', aliases: ['yeezy', 'adidas yeezy'],
        intro: 'Yeezy Boost 350, 380 and 700 are some of the most faked shoes ever made. Buy thrifted Yeezys only from a seller who checks every pair — like us.',
        points: ['Yeezy Boost 350 V2, 380, 700 and Slides', 'Carefully authenticity checked', 'Real photos of the exact pair']
    },
    fila: {
        name: 'Fila', aliases: ['fila'],
        intro: 'Fila is known for chunky retro sneakers like the Disruptor and Ray Tracer — bold style at a friendly price.',
        points: ['Disruptor, Ray Tracer and classic tennis styles', 'Chunky retro look', 'Budget friendly']
    },
    hoka: {
        name: 'Hoka', aliases: ['hoka', 'hoka one one'],
        intro: 'Hoka running shoes have thick, soft midsoles that runners and people on their feet all day love — the Clifton, Bondi and Speedgoat are favourites.',
        points: ['Clifton, Bondi, Arahi and Speedgoat', 'Maximum cushioning', 'Great for walking and running']
    },
    salomon: {
        name: 'Salomon', aliases: ['salomon'],
        intro: 'Salomon trail shoes like the XT-6 and Speedcross are made for hiking — and are now a big fashion trend too. Perfect for the northern areas or the city.',
        points: ['XT-6, XT-4, Speedcross and hiking shoes', 'Strong grip and durable', 'Trail and street style']
    },
    timberland: {
        name: 'Timberland', aliases: ['timberland'],
        intro: 'The Timberland yellow boot is a winter classic. Tough leather, waterproof builds and a look that lasts for years.',
        points: ['6-inch premium boots, chukkas and boat shoes', 'Great for winter', 'Leather cleaned and conditioned']
    },
    'dr-martens': {
        name: 'Dr. Martens', aliases: ['dr. martens', 'dr martens', 'doc martens'],
        intro: 'Dr. Martens 1460 boots and 1461 shoes are iconic. Thrifted pairs are often already broken in — which Docs fans know is a big bonus.',
        points: ['1460 boots, 1461 shoes and Chelsea boots', 'Often already broken in', 'Leather checked and cleaned']
    }
};

// Extra brand names for the admin brand list (with the ones above)
export const MORE_BRANDS = [
    'Crocs', 'Birkenstock', 'Clarks', 'Lacoste', 'Tommy Hilfiger', 'Calvin Klein', 'Hush Puppies', 'Ecco', 'Geox', 'Saucony',
    'Brooks', 'Mizuno', 'Diadora', 'Kappa', 'Champion', 'Le Coq Sportif', 'Lotto', 'Umbro', 'Merrell', 'Columbia',
    'The North Face', 'Caterpillar', 'Steve Madden', 'Aldo', 'Balenciaga', 'Gucci', 'Off-White', 'Golden Goose', 'Alexander McQueen', 'Louis Vuitton',
    'Prada', 'Valentino', 'Dior', 'Versace', 'Hugo Boss', 'Polo Ralph Lauren', 'Levi\'s', 'Superga', 'Veja', 'K-Swiss',
    'DC Shoes', 'Etnies', 'Ellesse', 'Karrimor', 'Li-Ning', 'Anta', 'Xtep', 'Peak', 'Bata', 'Service'
];

export const CITY_INFO = {
    lahore: { name: 'Lahore', note: 'From DHA and Gulberg to Johar Town, Model Town and the walled city' },
    karachi: { name: 'Karachi', note: 'From Clifton and DHA to Gulshan, North Nazimabad and Korangi' },
    islamabad: { name: 'Islamabad', note: 'All sectors — F, G, E, I, DHA, Bahria and Gulberg Greens' },
    rawalpindi: { name: 'Rawalpindi', note: 'Saddar, Satellite Town, Bahria Town, Chaklala and beyond' },
    faisalabad: { name: 'Faisalabad', note: 'D Ground, Madina Town, Peoples Colony and all areas' },
    multan: { name: 'Multan', note: 'Cantt, Gulgasht, Bosan Road, DHA and all areas' },
    peshawar: { name: 'Peshawar', note: 'Hayatabad, University Town, Saddar and all areas' },
    gujranwala: { name: 'Gujranwala', note: 'Satellite Town, Model Town, DC Road and all areas' },
    sialkot: { name: 'Sialkot', note: 'Cantt, Paris Road, Defence Road and all areas' },
    quetta: { name: 'Quetta', note: 'Jinnah Road, Samungli Road, Cantt and all areas' },
    hyderabad: { name: 'Hyderabad', note: 'Latifabad, Qasimabad, Saddar and all areas' },
    bahawalpur: { name: 'Bahawalpur', note: 'Model Town, Satellite Town and all areas' },
    sargodha: { name: 'Sargodha', note: 'Satellite Town, University Road and all areas' },
    abbottabad: { name: 'Abbottabad', note: 'Supply, Mandian, Jinnahabad and all areas' }
};
