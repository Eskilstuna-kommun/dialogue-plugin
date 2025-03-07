import Origo from 'Origo';
import $ from 'jquery';
import store from './editsstore';
import generateUUID from '../utils/generateuuid';
import transactionHandler from './transactionhandler';
import dispatcher from './editdispatcher';
import editForm from './editform';
import imageresizer from '../utils/imageresizer';
import getImageOrientation from '../utils/getimageorientation';
import shapes from './shapes';

const editsStore = store();
let editLayers = {};
let autoSave;
let autoForm;
let editSource;
let map;
let currentLayer;
let editableLayers;
let attributes;
let title;
let draw;
let hasDraw;
let hasAttribute;
let hasSnap;
let select;
let modify;
let snap;
let viewer;
let featureInfo;
let modal;
let allLayersSelectable;
let selectableLayers;

function isActive() {
  if (modify === undefined || select === undefined) {
    return false;
  }
  return true;
}

function setActive(editType) {
  switch (editType) {
    case 'modify':
      draw.setActive(false);
      modify.setActive(true);
      select.setActive(true);
      break;
    case 'draw':
      draw.setActive(true);
      modify.setActive(true);
      select.setActive(false);
      break;
    default:
      draw.setActive(false);
      hasDraw = false;
      modify.setActive(true);
      select.setActive(true);
      break;
  }
}

function getFeaturesByIds(type, layer, ids) {
  const source = layer.getSource();
  const features = [];
  if (type === 'delete') {
    ids.forEach((id) => {
      const dummy = new Origo.ol.Feature();
      dummy.setId(id);
      features.push(dummy);
    });
  } else {
    ids.forEach((id) => {
      let feature;
      if (source.getFeatureById(id)) {
        feature = source.getFeatureById(id);
        feature.unset('bbox');
        features.push(feature);
      }
    });
  }
  return features;
}

function getDefaultValues(attrs) {
  return attrs.filter(attribute => attribute.name && attribute.defaultValue)
    .reduce((prev, curr) => {
      const previous = prev;
      previous[curr.name] = curr.defaultValue;
      return previous;
    }, {});
}

function getSnapSources(layers) {
  return layers.map(layer => viewer.getLayer(layer).getSource());
}

function saveFeatures() {
  const edits = editsStore.getEdits();
  const layerNames = Object.getOwnPropertyNames(edits);
  layerNames.forEach((layerName) => {
    const transaction = {
      insert: null,
      delete: null,
      update: null
    };
    const editTypes = Object.getOwnPropertyNames(edits[layerName]);
    editTypes.forEach((editType) => {
      const layer = viewer.getLayer(layerName);
      const ids = edits[layerName][editType];
      const features = getFeaturesByIds(editType, layer, ids);
      if (features.length) {
        transaction[editType] = features;
      }
    });

    transactionHandler(transaction, layerName, viewer);
  });
}

function saveFeature(change) {
  dispatcher.emitChangeFeature(change);
  if (autoSave) {
    saveFeatures(change);
  }
}

function onSelect(evt) {
  if (allLayersSelectable && evt.selected.length > 0) {
    setEditLayer(select.getLayer(evt.selected[0]).get('name'), true);
  }
}

function onModifyEnd(evt) {
  const feature = evt.features.item(0);
  saveFeature({
    feature,
    layerName: currentLayer,
    action: 'update'
  });
}

function onDrawEnd(evt) {
  const feature = evt.feature;
  const layer = viewer.getLayer(currentLayer);
  const defaultAttributes = getDefaultValues(layer.get('attributes'));
  feature.setProperties(defaultAttributes);
  feature.setId(generateUUID());
  editSource.addFeature(feature);
  setActive();
  hasDraw = false;
  saveFeature({
    feature,
    layerName: currentLayer,
    action: 'insert'
  });
  dispatcher.emitChangeEdit('draw', false);
  if (autoForm) {
    editAttributes(feature);
  }
}

function addSnapInteraction(sources) {
  const snapInteractions = [];
  sources.forEach((source) => {
    const interaction = new Origo.ol.interaction.Snap({
      source
    });
    snapInteractions.push(interaction);
    map.addInteraction(interaction);
  });
  return snapInteractions;
}

function removeInteractions(interactionType) {
  let interaction = interactionType;
  if (isActive()) {
    if (interaction) {
      map.removeInteraction(interaction);
      interaction = undefined;
    } else {
      map.removeInteraction(modify);
      map.removeInteraction(select);
      map.removeInteraction(draw);
      if (snap) {
        snap.forEach((snapInteraction) => {
          map.removeInteraction(snapInteraction);
        });
      }

      modify = undefined;
      select = undefined;
      draw = undefined;
      snap = undefined;
    }
  }
}

function setInteractions(drawType, setBySelection) {
  const editLayer = editLayers[currentLayer];
  editSource = editLayer.getSource();
  attributes = editLayer.get('attributes');
  title = editLayer.get('title') || 'Information';
  const drawOptions = {
    source: editSource,
    type: editLayer.get('geometryType'),
    geometryName: editLayer.get('geometryName')
  };
  if (drawType) {
    $.extend(drawOptions, shapes(drawType));
  }

  if (setBySelection) {
    removeInteractions(draw);
  } else {
    removeInteractions();

    select = new Origo.ol.interaction.Select({
      layers: allLayersSelectable ? selectableLayers : Object.keys(editLayers).map(e => editLayers[e])
    });

    modify = new Origo.ol.interaction.Modify({
      features: select.getFeatures()
    });

    map.addInteraction(select);
    map.addInteraction(modify);
    select.on('select', onSelect, this);
    modify.on('modifyend', onModifyEnd, this);
  }

  draw = new Origo.ol.interaction.Draw(drawOptions);
  hasDraw = false;
  hasAttribute = false;
  map.addInteraction(draw);
  draw.on('drawend', onDrawEnd, this);
  setActive();

  // If snap should be active then add snap internactions for all snap layers
  hasSnap = editLayer.get('snap');
  if (hasSnap) {
    const selectionSource = featureInfo.getSelectionLayer().getSource();
    const snapSources = editLayer.get('snapLayers') ? getSnapSources(editLayer.get('snapLayers')) : [editLayer.get('source')];
    snapSources.push(selectionSource);
    snap = addSnapInteraction(snapSources);
  }
}

function setEditLayer(layerName, setBySelection) {
  currentLayer = layerName;
  setInteractions(undefined, setBySelection);
}

function setGeometryProps(layer) {
  const layerName = layer.get('name');
  editLayers[layerName].set('geometryType', layer.getSource().getFeatures()[0].getGeometry().getType());
  if (layerName === currentLayer) {
    setEditLayer(layerName);
  }
}

function addFeatureAddListener(layerName) {
  const layer = viewer.getLayer(layerName);
  layer.getSource().once('addfeature', () => {
    setGeometryProps(layer);
  });
}

function verifyLayer(layerName) {
  if (!(editLayers[layerName].get('geometryType'))) {
    addFeatureAddListener(layerName);
  }
}

function setEditProps(options) {
  const initialValue = {};
  const result = editableLayers.reduce((layerProps, layerName) => {
    const layer = viewer.getLayer(layerName);
    const layerProperties = layerProps;
    const snapLayers = options.snapLayers || editableLayers;
    snap = 'snap' in options ? options.snap : true;
    layer.set('snap', snap);
    layer.set('snapLayers', snapLayers);
    layerProperties[layerName] = layer;
    return layerProps;
  }, initialValue);
  return result;
}

function onDeleteSelected() {
  const features = select.getFeatures();

  // Make sure all features are loaded in the source
  editSource = editLayers[currentLayer].getSource();
  if (features.getLength() === 1) {
    const feature = features.item(0);
    const r = confirm('Är du säker på att du vill ta bort det här objektet?');
    if (r === true) {
      saveFeature({
        feature,
        layerName: currentLayer,
        action: 'delete'
      });
      select.getFeatures().clear();
      editSource.removeFeature(editSource.getFeatureById(feature.getId()));
    }
  }
}

function startDraw() {
  if (hasDraw !== true && isActive()) {
    setActive('draw');
    hasDraw = true;
    dispatcher.emitChangeEdit('draw', true);
  }
}

function cancelDraw() {
  setActive();
  hasDraw = false;
  dispatcher.emitChangeEdit('draw', false);
}

function onChangeShape(e) {
  setInteractions(e.shape);
  startDraw();
}

function cancelAttribute() {
  modal.closeModal();
  dispatcher.emitChangeEdit('attribute', false);
}

function attributesSaveHandler(feature, formEl) {
  // get DOM values and set attribute values to feature
  attributes.forEach((attribute) => {
    if (Object.prototype.hasOwnProperty.call(formEl, attribute.name)) {
      feature.set(attribute.name, formEl[attribute.name]);
    }
  });
  saveFeature({
    feature,
    layerName: currentLayer,
    action: 'update'
  });
}

function onAttributesSave(feature, attrs) {
  $('#o-save-button').on('click', (e) => {
    const editEl = {};
    const checkboxValues = [];
    let fileReader;
    let input;
    let file;

    // Read values from form
    attrs.forEach((attribute) => {
      // Get the input container class
      const containerClass = `.${attribute.elId.slice(1)}`;

      // If hidden element it should be excluded
      if ($(containerClass).hasClass('o-hidden') === false) {
        // Check if checkbox. If checkbox read state.
        if ($(`[id^=${attribute.elId.substring(1)}]`).attr('type') === 'checkbox') {
          if (attribute.options && attribute.options.length > 0) {
            $(`input[name="${attribute.name}"]:checked`).each((index, element) => {
              if ($(element).next().is('input[type="text"]')) {
                if ($(element).next().val()) {
                  checkboxValues.push($(element).next().val().trim());
                }
              } else {
                checkboxValues.push($(element).val());
              }
            });

            editEl[attribute.name] = checkboxValues.join('; ');
          } else {
            editEl[attribute.name] = $(attribute.elId).is(':checked') ? 1 : 0;
          }
        } else { // Read value from input text, textarea or select
          editEl[attribute.name] = $(attribute.elId).val();
        }
      }
      // Check if file. If file, read and trigger resize
      if ($(attribute.elId).attr('type') === 'file') {
        input = $(attribute.elId)[0];
        file = input.files[0];

        if (file) {
          fileReader = new FileReader();
          fileReader.onload = () => {
            if (typeof file !== 'undefined') {
              getImageOrientation(file, (orientation) => {
                imageresizer(fileReader.result, attribute, orientation, (resized) => {
                  editEl[attribute.name] = resized;
                  $(document).trigger('imageresized');
                });
              });
            }
          };

          fileReader.readAsDataURL(file);
          fileReader.onload = () => {
            editEl[attribute.name] = fileReader.result;
            $(document).trigger('imageresized');
          };
        } else {
          editEl[attribute.name] = $(attribute.elId).attr('value');
        }
      }

      // Read from sessionStorage if applicable
      if (attribute.type === 'storage') {
        editEl[attribute.name] = sessionStorage[attribute.name];
      }
    });

    if (fileReader && fileReader.readyState === 1) {
      $(document).on('imageresized', () => {
        attributesSaveHandler(feature, editEl);
      });
    } else {
      attributesSaveHandler(feature, editEl);
    }

    modal.closeModal();
    $('#o-save-button').blur();
    e.preventDefault();
  });
}

function addListener() {
  const fn = (obj) => {
    $(obj.elDependencyId).on(obj.eventType, () => {
      const containerClass = `.${obj.elId.slice(1)}`;
      if ($(`${obj.elDependencyId} option:selected`).text() === obj.requiredVal) {
        $(containerClass).removeClass('o-hidden');
      } else {
        $(containerClass).addClass('o-hidden');
      }
    });
  };

  return fn;
}

function addCheckboxListener() {
  const fn = (obj) => {
    $(`input[name="${obj.name}"]`).on('change', (e) => {
      if ($(e.currentTarget).is(':checked')) {
        $(e.currentTarget).next('input[type="text"]').prop('disabled', false);
      } else {
        $(e.currentTarget).next('input[type="text"]').val('');
        $(e.currentTarget).next('input[type="text"]').prop('disabled', true);
      }
    });
  };

  return fn;
}

function addImageListener() {
  const fn = (obj) => {
    const fileReader = new FileReader();
    const containerClass = `.${obj.elId.slice(1)}`;
    $(obj.elId).on('change', (ev) => {
      if (ev.target.files && ev.target.files[0]) {
        $(`${containerClass} img`).removeClass('o-hidden');
        $(`${containerClass} input[type=button]`).removeClass('o-hidden');
        fileReader.onload = (e) => {
          $(`${containerClass} img`).attr('src', e.target.result);
        };
        fileReader.readAsDataURL(ev.target.files[0]);
      }
    });

    $(`${containerClass} input[type=button]`).on('click', (e) => {
      $(obj.elId).attr('value', '');
      $(`${containerClass} img`).addClass('o-hidden');
      $(e.target).addClass('o-hidden');
    });
  };

  return fn;
}

function editAttributes(feat) {
  let feature = feat;
  let attributeObjects;
  let features;

  // Get attributes from the created, or the selected, feature and fill DOM elements with the values
  if (feature) {
    features = new Origo.ol.Collection();
    features.push(feature);
  } else {
    features = select.getFeatures();
  }
  if (features.getLength() === 1) {
    dispatcher.emitChangeEdit('attribute', true);
    feature = features.item(0);
    if (attributes.length > 0) {
      // Create an array of defined attributes and corresponding values from selected feature
      attributeObjects = attributes.map((attributeObject) => {
        const obj = {};
        $.extend(obj, attributeObject);
        obj.val = feature.get(obj.name) !== undefined ? feature.get(obj.name) : '';
        if ('constraint' in obj) {
          const constraintProps = obj.constraint.split(':');
          if (constraintProps.length === 3) {
            obj.eventType = constraintProps[0];
            obj.dependencyVal = feature.get(constraintProps[1]);
            obj.requiredVal = constraintProps[2];
            obj.isVisible = obj.dependencyVal === obj.requiredVal;
            obj.addListener = addListener();
            obj.elId = `#input-${obj.name}-${obj.requiredVal}`;
            obj.elDependencyId = `#input-${constraintProps[1]}`;
          } else {
            alert('Villkor verkar inte vara rätt formulerat. Villkor formuleras enligt principen change:attribute:value');
          }
        } else if (obj.type === 'checkbox') {
          if (obj.options && obj.options.length > 0 && obj.val) {
            obj.val = obj.val.split('; ');
          }
          obj.isVisible = true;
          obj.elId = `#input-${obj.name}`;
          obj.addListener = addCheckboxListener();
        } else if (obj.type === 'image') {
          obj.isVisible = true;
          obj.elId = `#input-${obj.name}`;
          obj.addListener = addImageListener();
        } else {
          obj.isVisible = true;
          obj.elId = `#input-${obj.name}`;
        }

        obj.formElement = editForm(obj);
        return obj;
      });
    }

    const formElement = attributeObjects.reduce((prev, next) => prev + next.formElement, '');
    const form = `<form>${formElement}<br><div class="o-form-save"><input id="o-save-button" type="button" value="Ok"></input></div></form>`;

    modal = Origo.ui.Modal({
      title,
      headerStyle: `background-color: ${viewer.getLayer(currentLayer).get('customLegendColor')}; border-radius: 6px 6px 0 0;`,
      content: form,
      static: true,
      target: viewer.getId()
    });

    attributeObjects.forEach((obj) => {
      if ('addListener' in obj) {
        obj.addListener(obj);
      }
    });

    onAttributesSave(feature, attributeObjects);
  }
}

function onToggleEdit(e) {
  e.stopPropagation();
  if (e.tool === 'draw') {
    if (hasDraw === false) {
      setInteractions();
      startDraw();
    } else {
      cancelDraw();
    }
  } else if (e.tool === 'attribute') {
    if (hasAttribute === false) {
      editAttributes();
    } else {
      cancelAttribute();
    }
  } else if (e.tool === 'delete') {
    onDeleteSelected();
  } else if (e.tool === 'edit') {
    setEditLayer(e.currentLayer);
  } else if (e.tool === 'cancel') {
    removeInteractions();
  } else if (e.tool === 'save') {
    saveFeatures();
  }
}

function onChangeEdit(e) {
  if (e.tool !== 'draw' && e.active) {
    cancelDraw();
  }
}

export default function editHandler(options, v) {
  viewer = v;
  featureInfo = viewer.getControlByName('featureInfo');
  map = viewer.getMap();
  currentLayer = options.currentLayer;
  editableLayers = options.editableLayers;
  allLayersSelectable = options.allLayersSelectable;
  selectableLayers = allLayersSelectable ? viewer.getLayersByProperty('editable', true) : undefined;

  // set edit properties for editable layers
  editLayers = setEditProps(options);
  editableLayers.forEach((layerName) => {
    verifyLayer(layerName);
    if (layerName === currentLayer) {
      dispatcher.emitEnableInteraction();
      setEditLayer(layerName);
    }
  });

  autoSave = options.autoSave;
  autoForm = options.autoForm;
  $(document).on('toggleEdit', onToggleEdit);
  $(document).on('changeEdit', onChangeEdit);
  $(document).on('editorShapes', onChangeShape);
}
