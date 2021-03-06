import { Component, OnInit, OnDestroy } from '@angular/core';

import * as L from 'leaflet';

import 'leaflet.markercluster';

import 'leaflet.fullscreen';

import * as Search from 'leaflet-search';

import { HTTPService } from '../../services/http.service';

import { ConfigService } from '../../services/config.service';

import { SidebarService } from 'src/app/services/sidebar.service';

import { MapService } from 'src/app/services/map.service';

import { LayerType } from 'src/app/enum/layer-type.enum';

import { Layer } from 'src/app/models/layer.model';

import { Legend } from 'src/app/models/legend.model';

import { Group } from 'src/app/models/group.model';

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.css']
})
export class MapComponent implements OnInit {

  private map: L.Map;

  selectedLayers: Layer[] = [];

  legends: Legend[] = [];

  private mapConfig;

  private layerControl: L.Control.Layers;
  private searchControl;

  markerClusterGroup: L.MarkerClusterGroup;

  displayTable = false;
  displayFilter = false;
  displayLegend = false;
  displayInfo = false;

  filteredData = [];

  constructor(
    private hTTPService: HTTPService,
    private configService: ConfigService,
    private sidebarService: SidebarService,
    private mapService: MapService
  ) { }

  ngOnInit() {
    this.mapConfig = this.configService.getConfig('map');
    this.setMap();
    this.setControls();
    this.setLayers();
  }

  setMap() {
    this.map = L.map('map', {maxZoom: this.mapConfig.maxZoom});
    this.panMap(this.mapConfig.initialLatLong, this.mapConfig.initialZoom);
    L.Marker.prototype.options.icon = L.icon({
      iconRetinaUrl: 'assets/marker-icon-2x.png',
      iconUrl: 'assets/marker-icon.png',
      shadowUrl: 'assets/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      tooltipAnchor: [16, -28],
      shadowSize: [41, 41]
    });
  }

  setLayers() {
    this.setBaseLayers();
    // this.setMarkerOverlays();
    this.setOverlayEvents();
  }

  setBaseLayers() {
    this.mapConfig.baselayers.forEach(baseLayerData => {
      const baseLayer = this.getLayer(baseLayerData);
      const baseLayerName = baseLayerData.name;
      this.layerControl.addBaseLayer(baseLayer, baseLayerName);
      if (baseLayerData.default) {
        baseLayer.addTo(this.map);
      }
    });
  }

  setMarkers(data, popupTitle, overlayName) {
    this.layerControl.removeLayer(this.markerClusterGroup);
    this.markerClusterGroup.clearLayers();
    data.forEach(markerData => {
      const popupContent = this.getPopupContent(markerData, overlayName);

      if (popupTitle) {
        popupTitle = markerData[popupTitle];
      }

      const marker = this.createMarker(popupTitle, popupContent, new L.LatLng(markerData.lat, markerData.long));

      if (marker) {
        this.markerClusterGroup.addLayer(marker);
      }
    });

    this.layerControl.addOverlay(this.markerClusterGroup, overlayName);
    this.searchControl.setLayer(this.markerClusterGroup);
    this.searchControl.options.layer = this.markerClusterGroup;
  }

  createMarker(popupTitle, popupContent, latLong: L.LatLng) {
    if (!popupContent) {
      return null;
    }
    const marker = L.marker(latLong, {title: popupTitle});
    marker.bindPopup(popupContent);
    return marker;
  }

  // Leaflet controls

  setControls() {
    this.setLayerControl();

    this.setFullScreenControl();

    this.setScaleControl();

    this.setFilterControl();

    this.setLegendControl();

    this.setTableControl();

    this.setSearchControl();

    this.setInfoControl();

    this.setRestoreMapControl();

    this.setTimeDimension();

    this.setMarkersGroup();
  }

  setMarkersGroup() {
    this.markerClusterGroup = L.markerClusterGroup({chunkedLoading: true, spiderfyOnMaxZoom: true});
  }

  setOverlayEvents() {
    this.sidebarService.sidebarItemSelect.subscribe(itemSelected => {
      if (itemSelected instanceof Layer) {
        this.addLayer(itemSelected);
      }
      if (itemSelected instanceof Group) {
        const children = itemSelected.children;
        this.selectedLayers = this.selectedLayers.filter(selectedLayer => 'parent' in selectedLayer);
        children.forEach(child => this.addLayer(child));
      }
    });

    this.sidebarService.sidebarItemUnselect.subscribe(itemUnselected => {
      if (itemUnselected instanceof Layer) {
        this.removeLayer(itemUnselected);
      }
      if (itemUnselected instanceof Group) {
        const children = itemUnselected.children;
        children.forEach(child => this.removeLayer(child));
      }
    });

    this.sidebarService.sidebarItemRadioSelect.subscribe(layer => {
      const appConfig = this.configService.getConfig('app');
      let url = '';
      if (layer.type === LayerType.ANALYSIS) {
        url = appConfig.analysisLayerUrl;
      } else if (layer.type === LayerType.STATIC) {
        url = appConfig.staticLayerUrl;
      } else if (layer.type === LayerType.DYNAMIC) {
        url = appConfig.dynamicLayerUrl;
      }
      const viewId = layer.value;
      const defaultDateInterval = layer.defaultDateInterval;
      this.hTTPService.get(url, {viewId, defaultDateInterval})
                      .toPromise()
                      .then(data => this.setMarkers(data, null, layer.label));
    });

    this.sidebarService.sidebarItemRadioUnselect.subscribe(layer => {
      this.markerClusterGroup.clearLayers();
    });

    this.mapService.getFilteredData.subscribe(filteredData => {
      this.filteredData = filteredData;
      filteredData.pop();
      this.setMarkers(filteredData, '', 'Resultado do filtro');
    });

    this.mapService.resetLayers.subscribe(layers => {
      layers.forEach(layer => this.removeLayer(layer));
      layers.forEach(layer => this.addLayer(layer));
    });

  }

  setCqlFilter(layer) {
    if (layer.defaultDateInterval) {
      const days = layer.defaultDateInterval * 86400000;
      const dateColumn = layer.dateColumn;

      const date = new Date();
      const compareDate = new Date((date.getTime() - days));

      const compareDateStr = `${compareDate.getFullYear()}-${compareDate.getMonth() + 1}-${compareDate.getDate()} ${compareDate.getHours()}:${compareDate.getMinutes()}:${compareDate.getSeconds()}`;

      const cqlFilter = `${dateColumn} > '${compareDateStr}'`;

      layer.layerData.cql_filter = cqlFilter;

      return layer;
    }
  }

  addLayer(layer) {
    if (layer && layer.layerData) {
      const layerIndex = this.selectedLayers.findIndex(selectedLayer => selectedLayer.label === layer.label);
      if (layerIndex === -1) {
        this.selectedLayers.push(layer);
        layer = this.setCqlFilter(layer);
        const layerToAdd = this.getLayer(layer.layerData);
        layerToAdd.setZIndex((this.selectedLayers.length + 1));
        layerToAdd.addTo(this.map);
        // layerToAdd.bringToFront();
      }
    }
  }

  removeLayer(layer) {
    if (layer) {
      let layerToRemove = null;
      const layerData = layer.layerData;
      this.map.eachLayer((mapLayer: L.TileLayer.WMS) => {
        if (mapLayer.options.layers === layerData.layers) {
          layerToRemove = mapLayer;
        }
      });
      if (layerToRemove) {
        layerToRemove.removeFrom(this.map);
        const layerIndex = this.selectedLayers.findIndex(selectedLayer => selectedLayer.label === layer.label);
        this.selectedLayers.splice(layerIndex, 1);
      }
    }
  }

  getLayer(layerData) {
    layerData.crs = L.CRS.EPSG3857;
    if (layerData && layerData.hasOwnProperty('crs')) {
      layerData.crs = L.CRS.EPSG4326;
    }
    return L.tileLayer.wms(layerData.url, layerData);
  }

  panMap(latlng, zoom) {
    this.map.setView(latlng, zoom);
  }

  // Map controls

  setTimeDimension() {
  }

  setLayerControl() {
    this.layerControl = L.control.layers(
      {}, {},
      this.mapConfig.controls.layers
    ).addTo(this.map);
  }

  setFullScreenControl() {
    this.map.addControl(L.control.fullscreen(this.mapConfig.controls.fullscreen));
  }

  setScaleControl() {
    this.map.addControl(L.control.scale(this.mapConfig.controls.scale));
  }

  setFilterControl() {
    const Filter = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div');
        div.innerHTML = `
          <div id="filterBtn" class="leaflet-control-layers leaflet-custom-icon" title="Filtro">
            <a><i class='fas fa-filter'></i></a>
          </div>`;
        return div;
      }
    });

    new Filter({ position: 'topleft' }).addTo(this.map);

    this.setFilterControlEvent();
  }

  setFilterControlEvent() {
    document.querySelector('#filterBtn').addEventListener('click', () => this.displayFilter = !this.displayFilter);
  }

  setLegendControl() {
    const Legend = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div');
        div.innerHTML = `
          <div id="legendBtn" class="leaflet-control-layers leaflet-custom-icon leaflet-legend" title="Legendas">
            <a><i class='fas fa-th-list'></i></a>
          </div>`;
        return div;
      }
    });

    new Legend({ position: 'topleft' }).addTo(this.map);

    this.setLegendControlEvent();
  }

  setLegendControlEvent() {
    document.querySelector('#legendBtn').addEventListener('click', () => this.displayLegend = !this.displayLegend);
  }

  setTableControl() {
    const Table = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div');
        div.innerHTML = `
          <div id="tableBtn" class="leaflet-control-layers leaflet-custom-icon" title="Tabela">
            <a><i class='fas fa-table'></i></a>
          </div>`;
        return div;
      }
    });

    new Table({ position: 'topleft' }).addTo(this.map);

    this.setTableControlEvent();
  }

  setTableControlEvent() {
    document.querySelector('#tableBtn').addEventListener('click', () => this.displayTable = !this.displayTable);
  }

  setSearchControl() {
    const searchOptions = this.mapConfig.controls.search;
    searchOptions.marker = L.circleMarker([0, 0], this.mapConfig.controls.search.marker);
    this.searchControl = new Search(searchOptions);
    this.map.addControl(this.searchControl);
  }

  setInfoControl() {
    const Info = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div');
        div.innerHTML = `
          <div id="infoBtn" class="leaflet-control-layers leaflet-custom-icon leaflet-info" title="Informação">
            <a><i class='fas fa-info'></i></a>
          </div>`;
        return div;
      }
    });

    new Info({ position: 'topleft' }).addTo(this.map);

    this.setInfoControlEvent();
  }

  setInfoControlEvent() {
    document.querySelector('#infoBtn').addEventListener('click', () => {
      if (this.displayInfo === false) {
        this.displayInfo = true;
        document.querySelector('#infoBtn').classList.add('leaflet-custom-icon-selected');
        document.querySelector('#map').classList.remove('cursor-grab');
        document.querySelector('#map').classList.add('cursor-help');
        this.map.on('click', (event: MouseEvent) => this.getFeatureInfo(event));
      } else {
        this.displayInfo = false;
        document.querySelector('#infoBtn').classList.remove('leaflet-custom-icon-selected');
        document.querySelector('#map').classList.remove('cursor-help');
        document.querySelector('#map').classList.add('cursor-grab');
        this.map.off('click');
      }
    });
  }

  async getFeatureInfo(event: MouseEvent) {
    let popupTitle = '';
    let latLong;
    let popupContent = `<div class="popup-container">`;
    for (const selectedLayer of this.selectedLayers) {
      const layer = this.getLayer(selectedLayer.layerData);
      const layerName = selectedLayer.label;
      popupTitle = layerName;

      latLong = event['latlng'];

      const params = this.getFeatureInfoParams(layer, event);

      const url = `http://www.terrama2.dpi.inpe.br/mpmt/geoserver/wms`;
      await this.hTTPService.get(url, params).toPromise().then(info => {
        const features = info['features'];
        popupContent += this.getFeatureInfoPopup(layerName, features);
      });
    }

    popupContent += `</div>`;
    const marker = this.createMarker(popupTitle, popupContent, latLong);
    if (marker) {
      marker.addTo(this.map);
      marker.openPopup();
    }
  }

  getFeatureInfoParams(layer: L.TileLayer.WMS, event: MouseEvent) {
    const layerId = layer.wmsParams.layers;
    const layerPoint = this.map.layerPointToContainerPoint(event['layerPoint']);
    const bbox = this.map.getBounds().toBBoxString();
    const mapSize = this.map.getSize();
    const width = mapSize.x;
    const height = mapSize.y;
    const x = Math.round(layerPoint.x);
    const y = Math.round(layerPoint.y);
    const params = {
      service: 'WMS',
      version: '1.1.0',
      request: 'GetFeatureInfo',
      layers: layerId,
      bbox,
      width,
      height,
      query_layers: layerId,
      info_format: 'application/json',
      x,
      y
    };
    return params;
  }

  getFeatureInfoPopup(layerName: string, features: []) {
    let popupContent = '';
    features.forEach(feature => {
      const properties = feature['properties'];
      popupContent = this.getPopupContent(properties, layerName);
    });
    return popupContent;
  }

  getPopupContent(data, name) {
    let popupContent = '';
    let popupContentBody = '';
    Object.keys(data).forEach(key => {
      popupContentBody += `
          <tr>
            <td>${key}</td>
            <td>${data[key]}</td>
          </tr>
      `;
    });

    popupContent += `
        <br />
        <div class="table-responsive">
          <table class="table table-hover">
              <thead><th colspan="2">${name}</th></thead>
              ${popupContentBody}
          </table>
        </div>
    `;

    return popupContent;
  }

  setRestoreMapControl() {
    const Info = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div');
        div.innerHTML = `
          <div id="restoreMapBtn" class="leaflet-control-layers leaflet-custom-icon leaflet-restore-map" title="Restaurar mapa">
            <a><i class='fas fa-crosshairs'></i></a>
          </div>`;
        return div;
      }
    });

    new Info({ position: 'topleft' }).addTo(this.map);

    this.setRestoreMapControlEvent();
  }

  setRestoreMapControlEvent() {
    const initialLatLong = this.mapConfig.initialLatLong;
    const initialZoom = this.mapConfig.initialZoom;

    document.querySelector('#restoreMapBtn')
            .addEventListener('click', () => this.panMap(initialLatLong, initialZoom));
  }

  // Events

  onShowTable() {
    this.displayTable = true;
  }

  onHideTable() {
    this.displayTable = false;
  }

}
