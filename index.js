require("dotenv").config();
const { writeFileSync, writeFile } = require("fs");
const fetch = require("node-fetch");
const { stripHtml } = require("string-strip-html");
const metascraper = require("metascraper");
const jsonexport = require("jsonexport");

// api key
const apiKey = process.env.DISQUS_API_KEY || "";

// hashtag to look for
const keyword = "#FeedbackASAP";

// disqus apis
const postsApi = "https://disqus.com/api/3.0/forums/listPosts";
const detailsApi = "https://disqus.com/api/3.0/threads/details";

// disqus "forum" names for bio/medrxiv
const forums = ["biorxivstage", "medrxiv"];

async function getComments() {
  // collect all comments from bio/medrxiv
  let items = [];
  for (const forum of forums) {
    // set search params
    const params = new URLSearchParams();
    params.set("api_key", apiKey);
    params.set("forum", forum);
    params.set("limit", 100);

    // hard limit request pages
    for (let page = 0; page < 200; page++) {
      console.log(`Getting forum ${forum} page ${page + 1} of comments`);

      // get page of results
      const url = postsApi + "?" + params.toString();
      const { cursor, response } = await (await fetch(url)).json();

      // collect comments
      items = items.concat(response);

      // set next page
      if (cursor?.hasNext) params.set("cursor", cursor?.next);
      else break;
    }
  }

  console.log(`Found ${items.length} total comments`);

  // get only comments with keyword
  items = items.filter(({ message }) =>
    message.toLowerCase().includes(keyword.toLowerCase())
  );

  console.log(`Found ${items.length} comments with keywords`);

  // keep only comment properties we want
  items = items.map(({ thread, forum, message, createdAt, author }) => ({
    thread,
    forum,
    message: stripHtml(message).result,
    date: createdAt,
    username: author.username,
    name: author.name,
  }));

  // get link of comments
  items = await Promise.all(
    items.map(async ({ thread, ...rest }, index) => {
      console.log(`Getting url of comment ${index + 1}`);

      // set search params
      const params = new URLSearchParams();
      params.set("api_key", apiKey);
      params.set("thread", thread);

      // get link of page
      const url = detailsApi + "?" + params.toString();
      const { response } = await (await fetch(url)).json();
      const { link } = response;
      return { link, ...rest };
    })
  );

  // create rules for metascraper to extract metadata from html
  const toRule = (field) => [
    ({ htmlDom }) =>
      Array.from(
        htmlDom(`meta[name="${field}"]`).map(
          (index, node) => node.attribs["content"]
        )
      ).join(", "),
  ];
  const rules = {
    doi: toRule("citation_doi"),
    title: toRule("citation_title"),
    authors: toRule("citation_author"),
    date: toRule("citation_date"),
  };

  // get paper metadata from links
  items = await Promise.all(
    items.map(async ({ link, ...rest }, index) => {
      console.log(`Getting paper metadata of comment ${index + 1}`);

      // fetch html content of link
      const html = await (await fetch(link)).text();

      // extract out metadata from html
      const metadata = await metascraper([rules])({ html, url: link });

      // split object into comment info and paper info
      return { comment: { link, ...rest }, paper: metadata };
    })
  );

  // output to csv file
  const csv = await jsonexport(items, { headerPathString: " " });
  writeFileSync("output.csv", csv, "utf-8");
}

// run main script
getComments();
