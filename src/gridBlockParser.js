const gqlParser = require('./gqlParser');

const responsiveIMG = (techC, c, cI) => {
  return techC[cI].w > 42
    ? c.sizes.large
    : techC[cI].w > 25
    ? c.sizes.halflarge
    : techC[cI].w > 12
    ? c.sizes.medium
    : c.sizes.thumbnail;
};

// eslint-disable-next-line complexity
const addAttrs = (newAttrs = {}, block = {}, k = 0) => {
  const { blockName } = newAttrs;
  const append = {
    className: classMap(block.attrs.class.component[k]),
    style: { ...block.attrs.style.component[k] },
  };

  if (!newAttrs.attrs) newAttrs.attrs = {};
  newAttrs.attrs = {
    ...newAttrs.attrs,
    ...append,
  };
  const cell = (block.attrs.technical.component[k].h / block.attrs.technical.block.gridTemplateColumns) * 2;

  if (blockName == 'coreheading') {
    newAttrs.attrs.tagName = block.attrs.technical.component[k].tagName;
  }
  if (blockName == 'customimage') {
    newAttrs.attrs.url = newAttrs.url;
    newAttrs.attrs.style.height = `${cell}vw`;
  }
  if (blockName == 'customwrapper') {
    newAttrs.attrs.reasignTo = block.attrs.technical.component[k].reasignTo;
    newAttrs.attrs.style.height = `${cell}vw`;
  }
  if (block.attrs.data.component[k]) {
    newAttrs.attrs.mapQL = block.attrs.data.component[k].mapQL;
  }
  return newAttrs;
};
const tplBlock = () => ({
  blockName: 'core/columns',
  attrs: {
    style: {},
  },
  innerBlocks: [],
});
const classMap = (entries) => {
  return Object.entries(entries || {})
    .map(([key, value]) => {
      return `${value}-${key}`;
    })
    .join(' ');
};
const contentParse = (content, tagName = false) => (tagName ? `<${tagName}>${content}</${tagName}>` : content);

module.exports = (blocks, blockName = '', schema, { page, postSlug, catSlug } = {}) => {
  // eslint-disable-next-line complexity
  const value = blocks.map(async (block, i) => {
    if (block.blockName == blockName) {
      const skip = ((page || 1) - 1) * block.attrs.content.length;
      const limit = block.attrs.content.length;

      const res = block.attrs.data.block.dataSources
        ? await gqlParser(schema, block.attrs.data.block.dataSources, {
            skip,
            limit,
            ...(postSlug && { name: postSlug }),
            ...(catSlug && { terms: catSlug.split(',') }),
          })
        : {};
      // console.log('dataSourcesRes', res);

      const data = res[Object.keys(res).pop()];
      const posts = Array.isArray(data) ? data : [data];

      if (block.attrs.data.block.dataSources && data === null) {
        throw 'Empty data';
      }

      const newBlock = {
        ...tplBlock(),
        attrs: {
          style: {
            ...block.attrs.style.block,
          },
          dataSource: block.attrs.data.block.dataSources,
        },
      };
      block.attrs.content.slice(0, posts[0] ? posts.length : block.attrs.content.length).map(
        (columns, j) =>
          (newBlock.innerBlocks[j] = {
            // ...JSON.parse(JSON.stringify(tplBlock)),
            ...tplBlock(),
            blockName: `core/column`,
            attrs: {
              // ...tplBlock().attrs,
              style: {
                // ...tplBlock().attrs.style,
                ...block.attrs.style.section,
              },
            },
            // eslint-disable-next-line complexity
            innerBlocks: columns.map((column, k) => ({
              ...tplBlock(),
              ...addAttrs(column, block, k),
              attrs: {
                ...addAttrs(column, block, k).attrs,
                ...(posts[j] && {
                  data: posts[j],
                  ...posts[j].thumbnail,
                }),
              },
              ...(posts[j] &&
                block.attrs.technical.component[k].mapQL &&
                (column.blockName === 'coreheading' || column.blockName === 'coreparagraph') && {
                  innerHTML: contentParse(
                    posts[j][block.attrs.technical.component[k].mapQL],
                    block.attrs.technical.component[k].tagName
                  ),
                }),
            })),
          })
      );
      return newBlock;
    } else {
      return block;
    }
  });
  return value;
  // console.log(blocks, value);
};
